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
	repeat: number;
	notes: string;
};

export type Song = {
	title: string;
	bpm: number;
	tracks: SongTrack[];
};

export type SongServiceConfig = {
	soundfontPath: string;
	fluidsynthPath?: string;
	ffmpegPath?: string;
};

export type RenderedSong = {
	attachments: GeneratedAttachment[];
	durationSeconds: number;
};

type SongNote = {
	pitches: number[];
	startBeat: number;
	beats: number;
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
const NOTE_NAME = /^([A-G])([#b]?)(-?\d)$/;
const STEP_SEMITONES: Record<string, number> = {
	C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export const COMPOSE_SONG_DESCRIPTION = 'Compose an original song and attach it to your reply as an MP3 and a MIDI file. Use this when someone asks you to make, write, or play a song or music. Aim for 20-90 seconds unless asked otherwise (hard limit 180 seconds). Tracks play simultaneously from beat 0, so keep their total lengths (notes × repeat) equal. Only mention the song in your reply; the files are attached automatically.';

export const COMPOSE_SONG_PROPERTIES = {
	title: { type: 'string', minLength: 1, maxLength: 80 },
	bpm: { type: 'integer', minimum: 40, maximum: 240 },
	tracks: {
		type: 'array',
		minItems: 1,
		maxItems: MAX_TRACKS,
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['name', 'instrument', 'drums', 'velocity', 'repeat', 'notes'],
			properties: {
				name: { type: 'string', maxLength: 40 },
				instrument: {
					type: 'integer',
					minimum: 0,
					maximum: 127,
					description: 'General MIDI program: 0 piano, 4 electric piano, 24 nylon guitar, 29 overdriven guitar, 33 electric bass, 38 synth bass, 40 violin, 48 strings, 56 trumpet, 65 alto sax, 73 flute, 80 square lead, 81 saw lead, 88 pad. Ignored for drums.',
				},
				drums: {
					type: 'boolean',
					description: 'True for a percussion track. Pitches then pick drum sounds: 36 kick, 38 snare, 39 clap, 42 closed hi-hat, 46 open hi-hat, 49 crash, 51 ride.',
				},
				velocity: { type: 'integer', minimum: 1, maximum: 127, description: 'Loudness of every note in this track.' },
				repeat: { type: 'integer', minimum: 1, maximum: 64, description: 'How many times to play the notes back to back. Use it for loops such as drum or bass patterns.' },
				notes: {
					type: 'string',
					description: 'Space-separated tokens played in order, each PITCH:BEATS. PITCH is a note name with octave (C4 is middle C, F#3, Bb2), a MIDI number 0-127, pitches joined with + for a chord (C4+E4+G4), or R for a rest. BEATS is a quarter-note count such as 1, 0.5, 1.5, or 1/3. A lone | may separate bars and is ignored. Example: C4:1 E4:1 G4:2 | R:1 C4+E4+G4:3',
				},
			},
		},
	},
};

export class SongError extends Error {}

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
		const separator = token.lastIndexOf(':');
		if (separator <= 0) {
			throw new SongError(`Expected PITCH:BEATS but got: ${token}`);
		}
		const pitchPart = token.slice(0, separator);
		const beats = parseBeats(token.slice(separator + 1));
		if (pitchPart.toUpperCase() !== 'R') {
			parsed.push({ pitches: pitchPart.split('+').map(pitch => parsePitch(pitch)), startBeat: cursor, beats });
		}
		cursor += beats;
	}
	return { notes: parsed, beats: cursor };
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

// Format 1 Standard MIDI File: a conductor track with tempo, then one track per instrument.
export function buildSongMidi(song: Song): { midi: Buffer; durationSeconds: number; } {
	if (song.tracks.length === 0 || song.tracks.length > MAX_TRACKS) {
		throw new SongError(`A song needs 1-${MAX_TRACKS} tracks.`);
	}
	const bpm = Math.min(240, Math.max(40, Math.round(song.bpm)));
	const microsecondsPerBeat = Math.round(60_000_000 / bpm);
	const chunks: number[][] = [trackChunk([
		{ tick: 0, order: 0, bytes: metaText(0x03, song.title) },
		{ tick: 0, order: 0, bytes: [0xFF, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xFF, (microsecondsPerBeat >> 8) & 0xFF, microsecondsPerBeat & 0xFF] },
	])];

	let totalBeats = 0;
	let noteCount = 0;
	let melodicIndex = 0;
	for (const track of song.tracks) {
		const { notes, beats } = parseTrackNotes(track.notes);
		const repeat = Math.min(64, Math.max(1, Math.round(track.repeat)));
		totalBeats = Math.max(totalBeats, beats * repeat);
		noteCount += notes.reduce((sum, note) => sum + note.pitches.length, 0) * repeat;
		if (noteCount > MAX_SONG_NOTES) {
			throw new SongError(`Songs are limited to ${MAX_SONG_NOTES} notes.`);
		}

		const channel = track.drums ? DRUM_CHANNEL : MELODIC_CHANNELS[melodicIndex++];
		const velocity = Math.min(127, Math.max(1, Math.round(track.velocity)));
		const events: TrackEvent[] = [{ tick: 0, order: 0, bytes: metaText(0x03, track.name) }];
		if (!track.drums) {
			events.push({ tick: 0, order: 0, bytes: [0xC0 | channel, Math.min(127, Math.max(0, Math.round(track.instrument)))] });
		}
		for (let pass = 0; pass < repeat; pass++) {
			const offset = pass * beats;
			for (const note of notes) {
				const start = Math.round((note.startBeat + offset) * TICKS_PER_BEAT);
				const end = Math.max(start + 1, Math.round((note.startBeat + offset + note.beats) * TICKS_PER_BEAT));
				for (const pitch of note.pitches) {
					events.push(
						{ tick: start, order: 1, bytes: [0x90 | channel, pitch, velocity] },
						{ tick: end, order: 0, bytes: [0x80 | channel, pitch, 0] },
					);
				}
			}
		}
		chunks.push(trackChunk(events, Math.round(beats * repeat * TICKS_PER_BEAT)));
	}

	if (noteCount === 0) {
		throw new SongError('The song has no notes.');
	}
	const durationSeconds = (totalBeats * 60) / bpm;
	if (durationSeconds > MAX_SONG_SECONDS) {
		throw new SongError(`Songs are limited to ${MAX_SONG_SECONDS} seconds, this one is ${Math.round(durationSeconds)}.`);
	}

	const header = [0x4D, 0x54, 0x68, 0x64, ...uint32(6), 0x00, 0x01, (chunks.length >> 8) & 0xFF, chunks.length & 0xFF, (TICKS_PER_BEAT >> 8) & 0xFF, TICKS_PER_BEAT & 0xFF];
	return { midi: Buffer.from([...header, ...chunks.flat()]), durationSeconds };
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
		const { midi, durationSeconds } = buildSongMidi(song);
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
			await run(this.config.fluidsynthPath ?? 'fluidsynth', ['-ni', '-g', '0.6', '-r', '44100', '-T', 'wav', '-F', wavPath, this.config.soundfontPath, midiPath], signal);
			// loudnorm evens out volume across instrument mixes but resamples to 192kHz unless -ar is set.
			await run(this.config.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-af', 'loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '3', mp3Path], signal);
		} catch (error) {
			await Promise.all([midiPath, mp3Path].map(filePath => rm(filePath, { force: true })));
			throw error;
		} finally {
			await rm(wavPath, { force: true });
		}

		return {
			durationSeconds,
			attachments: [
				{ filePath: mp3Path, filename: `${slug}.mp3`, description: `AI generated song: ${song.title}`, kind: 'audio' },
				{ filePath: midiPath, filename: `${slug}.mid`, description: `MIDI for AI generated song: ${song.title}`, kind: 'midi' },
			],
		};
	}
}
