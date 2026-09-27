import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	access,
	mkdir,
	rm,
	writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GeneratedAttachment } from '../models/internal-models.js';

export type SongTrack = {
	name: string;
	instrument: number;
	drums: boolean;
	velocity: number;
	volume: number;
	pan: number;
	reverb: number;
	chorus: number;
};

export type SongPart = {
	track: string;
	notes: string;
	velocity: number | null;
};

export type SongSection = {
	name: string;
	beats: number;
	parts: SongPart[];
};

export type Song = {
	title: string;
	bpm: number;
	swing: number;
	humanize: number;
	tracks: SongTrack[];
	sections: SongSection[];
	arrangement: string[];
};

export type SongServiceConfig = {
	soundfontPath: string;
	fluidsynthPath?: string;
	ffmpegPath?: string;
};

export type BuiltSong = {
	midi: Buffer;
	durationSeconds: number;
	warnings: string[];
};

export type RenderedSong = {
	attachments: GeneratedAttachment[];
	durationSeconds: number;
	warnings: string[];
};

type SongNote = {
	pitches: number[];
	startBeat: number;
	beats: number;
	velocity: number | null;
	staccato: boolean;
};

type ParsedPart = {
	notes: SongNote[];
	beats: number;
	velocity: number | null;
};

type TrackEvent = {
	tick: number;
	// Note-offs sort before note-ons on the same tick so a repeated pitch retriggers instead of being cut.
	order: number;
	bytes: number[];
};

const TICKS_PER_BEAT = 480;
const DRUM_CHANNEL = 9;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
export const MAX_SONG_SECONDS = 180;
export const MAX_SONG_NOTES = 5000;
const MAX_TRACKS = 8;
const MAX_SECTIONS = 12;
const MAX_ARRANGEMENT = 32;
const STACCATO_GATE = 0.5;
const MAX_TIMING_JITTER_TICKS = 12;
const MAX_VELOCITY_JITTER = 10;
// Instrument releases and reverb tails ring past the last note, so the file runs a little longer than the music.
const TAIL_SECONDS = 2;
const BEAT_EPSILON = 1e-6;
const NOTE_TOKEN = /^(?<pitch>[^:]+):(?<beats>[\d./]+)(?:@(?<velocity>\d+))?(?<staccato>')?$/;
const NOTE_NAME = /^([A-G])([#b]?)(-?\d)$/;
const STEP_SEMITONES: Record<string, number> = {
	C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const CONTROL = {
	volume: 7,
	pan: 10,
	reverb: 91,
	chorus: 93,
};

export const COMPOSE_SONG_DESCRIPTION = 'Compose an original song and attach it to your reply as an MP3 and a MIDI file. Use this when someone asks you to make, write, or play a song or music. Aim for 30-90 seconds unless asked otherwise (hard limit 180 seconds). Define tracks (instruments and their mix), sections (intro, verse, chorus, bridge, outro) holding each track\'s looping pattern, then an arrangement listing the sections in play order. Craft: pick a key and a chord progression per section (I-V-vi-IV, vi-IV-I-V, i-VI-III-VII, ii-V-I for jazz) and keep every part in it; give each track its own register (bass E1-E3 on chord roots and fifths, chords and pads C3-C5, melody C4-C6 above them); write a singable melody with mostly stepwise motion, a repeated hook, and phrases that land on chord tones; build contrast by thinning or quieting verses and filling out choruses; add a drum fill at the end of a section and a crash on the first beat of the next; accent downbeats and backbeats and use soft ghost notes. If the result lists warnings, fix them and call again; a new call replaces the previous song. Only mention the song in your reply; the files are attached automatically.';

export const COMPOSE_SONG_PROPERTIES = {
	title: { type: 'string', minLength: 1, maxLength: 80 },
	bpm: { type: 'integer', minimum: 40, maximum: 240 },
	swing: {
		type: 'number',
		minimum: 0,
		maximum: 1,
		description: 'Eighth-note swing: 0 straight, 0.5 light shuffle, 1 full triplet swing for jazz, blues, and lo-fi.',
	},
	humanize: {
		type: 'number',
		minimum: 0,
		maximum: 1,
		description: 'Small random timing and loudness variation so parts sound played rather than programmed. Around 0.3-0.5 for acoustic styles, 0-0.1 for tight electronic music.',
	},
	tracks: {
		type: 'array',
		minItems: 1,
		maxItems: MAX_TRACKS,
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['name', 'instrument', 'drums', 'velocity', 'volume', 'pan', 'reverb', 'chorus'],
			properties: {
				name: { type: 'string', minLength: 1, maxLength: 40, description: 'Unique name that section parts refer to.' },
				instrument: {
					type: 'integer',
					minimum: 0,
					maximum: 127,
					description: 'General MIDI program: 0 piano, 4 electric piano, 16 organ, 24 nylon guitar, 25 steel guitar, 27 clean electric guitar, 29 overdriven guitar, 30 distortion guitar, 32 acoustic bass, 33 electric bass, 38 synth bass, 40 violin, 42 cello, 46 harp, 48 strings, 52 choir, 56 trumpet, 61 brass section, 65 alto sax, 71 clarinet, 73 flute, 80 square lead, 81 saw lead, 88 warm pad, 89 polysynth pad, 95 sweep pad. Ignored for drums.',
				},
				drums: {
					type: 'boolean',
					description: 'True for a percussion track; use at most one. Pitches then pick drum sounds: 36 kick, 37 side stick, 38 snare, 39 clap, 42 closed hi-hat, 44 pedal hi-hat, 46 open hi-hat, 41 43 45 47 48 50 toms low to high, 49 crash, 51 ride, 53 ride bell, 54 tambourine, 56 cowbell.',
				},
				velocity: { type: 'integer', minimum: 1, maximum: 127, description: 'Default loudness of this track\'s notes.' },
				volume: { type: 'integer', minimum: 0, maximum: 127, description: 'Mix level. Around 100 for leads, lower for backing parts.' },
				pan: { type: 'integer', minimum: -100, maximum: 100, description: 'Stereo position from -100 left to 100 right. Spread accompaniment (e.g. guitar -35, keys 35) and keep bass, kick, and lead near 0.' },
				reverb: { type: 'integer', minimum: 0, maximum: 127, description: 'Reverb send. 10-30 for bass and drums, 40-80 for pads, strings, and leads.' },
				chorus: { type: 'integer', minimum: 0, maximum: 127, description: 'Chorus send that widens pads, electric pianos, and clean guitars. Keep 0 for bass and drums.' },
			},
		},
	},
	sections: {
		type: 'array',
		minItems: 1,
		maxItems: MAX_SECTIONS,
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['name', 'beats', 'parts'],
			properties: {
				name: { type: 'string', minLength: 1, maxLength: 40 },
				beats: { type: 'integer', minimum: 1, maximum: 256, description: 'Section length in quarter-note beats, usually a multiple of 4 such as 16 or 32. Each part loops to fill it; tracks without a part stay silent.' },
				parts: {
					type: 'array',
					minItems: 1,
					maxItems: MAX_TRACKS,
					items: {
						type: 'object',
						additionalProperties: false,
						required: ['track', 'notes', 'velocity'],
						properties: {
							track: { type: 'string', description: 'Name of the track playing this part.' },
							notes: {
								type: 'string',
								description: 'Space-separated tokens played in order and looped to fill the section, each PITCH:BEATS with an optional @VELOCITY and an optional trailing \' for staccato. PITCH is a note name with octave (C4 is middle C, F#3, Bb2), a MIDI number 0-127, pitches joined with + for a chord (C4+E4+G4), or R for a rest. BEATS is a quarter-note count such as 1, 0.5, 1.5, or 1/3. @VELOCITY (1-127) sets one note\'s loudness for accents and ghost notes. A lone | may separate bars and is ignored. Example: C4:1@110 E4:0.5\' E4:0.5\' G4:2 | R:1 C4+E4+G4:3',
							},
							velocity: { type: ['integer', 'null'], description: 'Loudness 1-127 for this part, overriding the track velocity, or null. Use it for dynamics such as a quiet verse and a loud chorus.' },
						},
					},
				},
			},
		},
	},
	arrangement: {
		type: 'array',
		minItems: 1,
		maxItems: MAX_ARRANGEMENT,
		items: { type: 'string' },
		description: 'Section names in play order; repeat names to reuse sections, e.g. ["intro","verse","chorus","verse","chorus","outro"].',
	},
};

export class SongError extends Error {}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function parsePitch(token: string): number {
	if (/^\d+$/.test(token)) {
		const midi = Number(token);
		if (midi > 127) {
			throw new SongError(`MIDI pitch out of range: ${token}`);
		}
		return midi;
	}
	const match = NOTE_NAME.exec(token);
	if (!match) {
		throw new SongError(`Invalid pitch: ${token}`);
	}
	const [, step, accidental, octave] = match;
	let offset = 0;
	if (accidental === '#') {
		offset = 1;
	} else if (accidental === 'b') {
		offset = -1;
	}
	const midi = ((Number(octave) + 1) * 12) + STEP_SEMITONES[step] + offset;
	if (midi < 0 || midi > 127) {
		throw new SongError(`Pitch out of range: ${token}`);
	}
	return midi;
}

function parseBeats(token: string): number {
	const [numerator, denominator, extra] = token.split('/', 3);
	const beats = denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator);
	if (extra !== undefined || !Number.isFinite(beats) || beats <= 0) {
		throw new SongError(`Invalid beat length: ${token}`);
	}
	return beats;
}

export function parseTrackNotes(notes: string): { notes: SongNote[]; beats: number; } {
	const parsed: SongNote[] = [];
	let cursor = 0;
	for (const token of notes.split(/\s+/)) {
		if (token === '' || token === '|') {
			continue;
		}
		const groups = NOTE_TOKEN.exec(token)?.groups;
		if (!groups) {
			throw new SongError(`Expected PITCH:BEATS but got: ${token}`);
		}
		const beats = parseBeats(groups.beats);
		const staccato = groups.staccato !== undefined;
		let velocity: number | null = null;
		if (groups.velocity !== undefined) {
			velocity = Number(groups.velocity);
			if (velocity < 1 || velocity > 127) {
				throw new SongError(`Velocity must be 1-127: ${token}`);
			}
		}
		if (groups.pitch.toUpperCase() === 'R') {
			if (velocity !== null || staccato) {
				throw new SongError(`Rests take no velocity or staccato: ${token}`);
			}
		} else {
			parsed.push({
				pitches: groups.pitch.split('+').map(pitch => parsePitch(pitch)),
				startBeat: cursor,
				beats,
				velocity,
				staccato,
			});
		}
		cursor += beats;
	}
	return { notes: parsed, beats: cursor };
}

// Delays off-beat eighths toward the triplet position while keeping downbeats fixed and time monotonic.
function swingBeat(beat: number, swing: number): number {
	if (swing === 0) {
		return beat;
	}
	const whole = Math.floor(beat);
	const fraction = beat - whole;
	const midpoint = 0.5 + (swing / 6);
	if (fraction <= 0.5) {
		return whole + (fraction * midpoint * 2);
	}
	return whole + midpoint + ((fraction - 0.5) * (1 - midpoint) * 2);
}

// Seeded by the title so the same song always renders identically.
function seededRandom(seed: string): () => number {
	let state = 2_166_136_261;
	for (const char of seed) {
		state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 16_777_619);
	}
	return () => {
		state = (state + 0x6D_2B_79_F5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function variableLength(value: number): number[] {
	const bytes = [value & 0x7F];
	let rest = value >> 7;
	while (rest > 0) {
		bytes.unshift((rest & 0x7F) | 0x80);
		rest >>= 7;
	}
	return bytes;
}

function metaText(type: number, text: string): number[] {
	const bytes = [...Buffer.from(text, 'utf8')];
	return [0xFF, type, ...variableLength(bytes.length), ...bytes];
}

function uint32(value: number): number[] {
	return [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
}

function trackChunk(events: TrackEvent[], endTick = 0): number[] {
	const sorted = events.toSorted((left, right) => left.tick - right.tick || left.order - right.order);
	const data: number[] = [];
	let lastTick = 0;
	for (const event of sorted) {
		data.push(...variableLength(event.tick - lastTick), ...event.bytes);
		lastTick = event.tick;
	}
	// Trailing rests emit no events, so the end marker carries them or the track would stop at its last note-off.
	data.push(...variableLength(Math.max(0, endTick - lastTick)), 0xFF, 0x2F, 0x00);
	return [0x4D, 0x54, 0x72, 0x6B, ...uint32(data.length), ...data];
}

function mixSettings(track: SongTrack): number[] {
	return [
		Math.round(clamp(track.volume, 0, 127)),
		Math.round(((clamp(track.pan, -100, 100) + 100) / 200) * 127),
		Math.round(clamp(track.reverb, 0, 127)),
		Math.round(clamp(track.chorus, 0, 127)),
	];
}

function parseSections(song: Song, tracks: Map<string, SongTrack>, warnings: string[]): Map<string, { beats: number; parts: Map<string, ParsedPart>; }> {
	if (song.sections.length === 0 || song.sections.length > MAX_SECTIONS) {
		throw new SongError(`A song needs 1-${MAX_SECTIONS} sections.`);
	}
	const sections = new Map<string, { beats: number; parts: Map<string, ParsedPart>; }>();
	for (const section of song.sections) {
		if (sections.has(section.name)) {
			throw new SongError(`Duplicate section name: ${section.name}`);
		}
		const sectionBeats = Math.round(section.beats);
		if (sectionBeats < 1) {
			throw new SongError(`Section "${section.name}" needs at least 1 beat.`);
		}
		const parts = new Map<string, ParsedPart>();
		for (const part of section.parts) {
			if (!tracks.has(part.track)) {
				throw new SongError(`Section "${section.name}" uses unknown track "${part.track}".`);
			}
			if (parts.has(part.track)) {
				throw new SongError(`Section "${section.name}" has two parts for track "${part.track}"; combine them into one.`);
			}
			const parsed = parseTrackNotes(part.notes);
			if (parsed.beats === 0) {
				throw new SongError(`Part "${part.track}" in section "${section.name}" is empty.`);
			}
			if (parsed.beats > sectionBeats + BEAT_EPSILON) {
				throw new SongError(`Part "${part.track}" in section "${section.name}" is ${parsed.beats} beats, longer than the ${sectionBeats}-beat section.`);
			}
			const loops = sectionBeats / parsed.beats;
			if (Math.abs(loops - Math.round(loops)) > BEAT_EPSILON) {
				warnings.push(`Part "${part.track}" in section "${section.name}" is ${parsed.beats} beats, which does not divide the ${sectionBeats}-beat section, so its last loop is cut off.`);
			}
			const velocity = part.velocity === null ? null : Math.round(clamp(part.velocity, 1, 127));
			parts.set(part.track, { ...parsed, velocity });
		}
		sections.set(section.name, { beats: sectionBeats, parts });
	}
	return sections;
}

// Format 1 Standard MIDI File: a conductor track with tempo, then one track per instrument.
export function buildSongMidi(song: Song): BuiltSong {
	if (song.tracks.length === 0 || song.tracks.length > MAX_TRACKS) {
		throw new SongError(`A song needs 1-${MAX_TRACKS} tracks.`);
	}
	if (song.arrangement.length === 0 || song.arrangement.length > MAX_ARRANGEMENT) {
		throw new SongError(`The arrangement needs 1-${MAX_ARRANGEMENT} sections.`);
	}
	const tracks = new Map<string, SongTrack>();
	for (const track of song.tracks) {
		if (tracks.has(track.name)) {
			throw new SongError(`Duplicate track name: ${track.name}`);
		}
		tracks.set(track.name, track);
	}
	const warnings: string[] = [];
	const sections = parseSections(song, tracks, warnings);

	const arranged: { beats: number; parts: Map<string, ParsedPart>; startBeat: number; }[] = [];
	let totalBeats = 0;
	for (const name of song.arrangement) {
		const section = sections.get(name);
		if (!section) {
			throw new SongError(`The arrangement uses unknown section "${name}".`);
		}
		arranged.push({ ...section, startBeat: totalBeats });
		totalBeats += section.beats;
	}
	const bpm = clamp(Math.round(song.bpm), 40, 240);
	const durationSeconds = (totalBeats * 60) / bpm;
	if (durationSeconds > MAX_SONG_SECONDS) {
		throw new SongError(`Songs are limited to ${MAX_SONG_SECONDS} seconds, this one is ${Math.round(durationSeconds)}.`);
	}
	for (const name of sections.keys()) {
		if (!song.arrangement.includes(name)) {
			warnings.push(`Section "${name}" is not in the arrangement, so it never plays.`);
		}
	}

	const swing = clamp(song.swing, 0, 1);
	const humanize = clamp(song.humanize, 0, 1);
	const random = seededRandom(song.title);
	const totalTicks = Math.round(totalBeats * TICKS_PER_BEAT);
	const microsecondsPerBeat = Math.round(60_000_000 / bpm);
	const tailTicks = Math.round(((TAIL_SECONDS * bpm) / 60) * TICKS_PER_BEAT);
	const chunks: number[][] = [trackChunk([
		{ tick: 0, order: 0, bytes: metaText(0x03, song.title) },
		{ tick: 0, order: 0, bytes: [0xFF, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xFF, (microsecondsPerBeat >> 8) & 0xFF, microsecondsPerBeat & 0xFF] },
	], totalTicks + tailTicks)];

	let noteCount = 0;
	let melodicIndex = 0;
	let drumMix: { name: string; settings: number[]; } | undefined;
	for (const track of song.tracks) {
		const channel = track.drums ? DRUM_CHANNEL : MELODIC_CHANNELS[melodicIndex++];
		const events: TrackEvent[] = [{ tick: 0, order: 0, bytes: metaText(0x03, track.name) }];
		if (!track.drums) {
			events.push({ tick: 0, order: 0, bytes: [0xC0 | channel, Math.round(clamp(track.instrument, 0, 127))] });
		}
		const settings = mixSettings(track);
		// Drum tracks share one channel, so a second track's controller changes would override the first.
		if (drumMix && track.drums) {
			if (settings.some((value, index) => value !== drumMix?.settings[index])) {
				warnings.push(`Drum tracks share one channel, so "${track.name}" uses the volume, pan, reverb, and chorus of "${drumMix.name}". Use one drums track.`);
			}
		} else {
			const controllers = [CONTROL.volume, CONTROL.pan, CONTROL.reverb, CONTROL.chorus];
			for (const [index, controller] of controllers.entries()) {
				events.push({ tick: 0, order: 0, bytes: [0xB0 | channel, controller, settings[index]] });
			}
			if (track.drums) {
				drumMix = { name: track.name, settings };
			}
		}

		let used = false;
		let outOfRange = 0;
		const trackVelocity = Math.round(clamp(track.velocity, 1, 127));
		for (const section of arranged) {
			const part = section.parts.get(track.name);
			if (!part) {
				continue;
			}
			used = true;
			const sectionEnd = section.startBeat + section.beats;
			for (let loopStart = section.startBeat; loopStart < sectionEnd - BEAT_EPSILON; loopStart += part.beats) {
				for (const note of part.notes) {
					const startBeat = loopStart + note.startBeat;
					if (startBeat >= sectionEnd - BEAT_EPSILON) {
						break;
					}
					const gate = note.staccato ? STACCATO_GATE : 1;
					const endBeat = Math.min(startBeat + (note.beats * gate), sectionEnd);
					const start = Math.round(swingBeat(startBeat, swing) * TICKS_PER_BEAT);
					const end = Math.max(start + 1, Math.round(swingBeat(endBeat, swing) * TICKS_PER_BEAT));
					// Only delaying note-ons keeps a retriggered pitch from starting before the previous note-off.
					const delay = Math.min(end - start - 1, Math.round(random() * humanize * MAX_TIMING_JITTER_TICKS));
					const baseVelocity = note.velocity ?? part.velocity ?? trackVelocity;
					for (const pitch of note.pitches) {
						const jitter = Math.round(((random() * 2) - 1) * humanize * MAX_VELOCITY_JITTER);
						const velocity = Math.round(clamp(baseVelocity + jitter, 1, 127));
						events.push(
							{ tick: start + delay, order: 1, bytes: [0x90 | channel, pitch, velocity] },
							{ tick: end, order: 0, bytes: [0x80 | channel, pitch, 0] },
						);
						if (track.drums ? pitch < 35 || pitch > 81 : pitch < 21 || pitch > 108) {
							outOfRange++;
						}
					}
					noteCount += note.pitches.length;
					if (noteCount > MAX_SONG_NOTES) {
						throw new SongError(`Songs are limited to ${MAX_SONG_NOTES} notes.`);
					}
				}
			}
		}
		if (!used) {
			warnings.push(`Track "${track.name}" has no part in any arranged section, so it never plays.`);
		}
		if (outOfRange > 0) {
			const range = track.drums ? 'the General MIDI drum map (35-81)' : 'the usual instrument range (A0-C8)';
			warnings.push(`Track "${track.name}" has ${outOfRange} notes outside ${range}, which may be silent or sound wrong.`);
		}
		chunks.push(trackChunk(events, totalTicks));
	}

	if (noteCount === 0) {
		throw new SongError('The song has no notes.');
	}

	const header = [0x4D, 0x54, 0x68, 0x64, ...uint32(6), 0x00, 0x01, (chunks.length >> 8) & 0xFF, chunks.length & 0xFF, (TICKS_PER_BEAT >> 8) & 0xFF, TICKS_PER_BEAT & 0xFF];
	return { midi: Buffer.from([...header, ...chunks.flat()]), durationSeconds, warnings };
}

async function run(command: string, args: string[], signal?: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const child = spawn(command, args, { signal, stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '';
	child.stderr.on('data', (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-2000);
	});
	child.on('error', reject);
	child.on('close', (code) => {
		if (code === 0) {
			resolve();
		} else {
			reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.trim()}`));
		}
	});
	return promise;
}

function slugify(title: string): string {
	const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
		.slice(0, 60);
	return slug || 'song';
}

export class SongService {
	private readonly config: SongServiceConfig;

	constructor(options: { config: SongServiceConfig; }) {
		this.config = options.config;
	}

	public async render(song: Song, signal?: AbortSignal): Promise<RenderedSong> {
		const { midi, durationSeconds, warnings } = buildSongMidi(song);
		// FluidSynth only warns about a missing soundfont and renders silence, so fail loudly first.
		await access(this.config.soundfontPath);

		const directory = path.join(os.tmpdir(), 'markov-songs');
		await mkdir(directory, { recursive: true });
		const slug = slugify(song.title);
		const base = path.join(directory, `${slug}-${randomUUID()}`);
		const midiPath = `${base}.mid`;
		const wavPath = `${base}.wav`;
		const mp3Path = `${base}.mp3`;

		try {
			await writeFile(midiPath, midi);
			// Large layered soundfonts stack many voices per note, so extra polyphony avoids notes cutting out in dense mixes.
			await run(this.config.fluidsynthPath ?? 'fluidsynth', [
				'-ni',
				'-g',
				'0.6',
				'-r',
				'44100',
				'-o',
				'synth.polyphony=512',
				'-o',
				'synth.reverb.room-size=0.6',
				'-o',
				'synth.reverb.damp=0.4',
				'-o',
				'synth.reverb.width=0.9',
				'-o',
				'synth.reverb.level=0.8',
				'-T',
				'wav',
				'-F',
				wavPath,
				this.config.soundfontPath,
				midiPath,
			], signal);
			// Gentle compression glues the mix before loudnorm evens out volume; -ar stops loudnorm resampling to 192kHz.
			await run(this.config.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-af', 'acompressor=threshold=-18dB:ratio=2:attack=20:release=250,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '3', mp3Path], signal);
		} catch (error) {
			await Promise.all([midiPath, mp3Path].map(filePath => rm(filePath, { force: true })));
			throw error;
		} finally {
			await rm(wavPath, { force: true });
		}

		return {
			durationSeconds,
			warnings,
			attachments: [
				{ filePath: mp3Path, filename: `${slug}.mp3`, description: `AI generated song: ${song.title}`, kind: 'audio' },
				{ filePath: midiPath, filename: `${slug}.mid`, description: `MIDI for AI generated song: ${song.title}`, kind: 'midi' },
			],
		};
	}
}
