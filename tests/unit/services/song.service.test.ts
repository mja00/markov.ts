import { describe, expect, it } from 'vitest';

import {
	MAX_SONG_SECONDS,
	Song,
	SongError,
	SongPart,
	SongSection,
	SongTrack,
	buildSongMidi,
	parseTrackNotes,
} from '../../../src/services/song.service.js';

const track = (overrides: Partial<SongTrack> = {}): SongTrack => {
	return {
		name: 'lead', instrument: 0, drums: false, velocity: 100, volume: 100, pan: 0, reverb: 40, chorus: 0, ...overrides,
	};
};

const part = (trackName: string, notes: string, velocity: number | null = null): SongPart => {
	return { track: trackName, notes, velocity };
};

const section = (name: string, beats: number, parts: SongPart[]): SongSection => {
	return { name, beats, parts };
};

const song = (tracks: SongTrack[], sections: SongSection[], overrides: Partial<Song> = {}): Song => {
	return {
		title: 'Test', bpm: 120, swing: 0, humanize: 0, tracks, sections, arrangement: sections.map(entry => entry.name), ...overrides,
	};
};

const containsBytes = (haystack: Buffer, needle: number[]): boolean => haystack.includes(Buffer.from(needle));

const countBytes = (haystack: Buffer, needle: number[]): number => {
	let count = 0;
	let index = haystack.indexOf(Buffer.from(needle));
	while (index !== -1) {
		count++;
		index = haystack.indexOf(Buffer.from(needle), index + 1);
	}
	return count;
};

describe('parseTrackNotes', () => {
	it('converts note names, accidentals, MIDI numbers, and chords to pitches', () => {
		const { notes } = parseTrackNotes('C4:1 F#3:1 Bb2:1 36:1 C4+E4+G4:1 C-1:1');

		expect(notes.map(note => note.pitches)).toEqual([[60], [54], [46], [36], [60, 64, 67], [0]]);
	});

	it('advances time across rests, fractions, and bar separators', () => {
		const { notes, beats } = parseTrackNotes('C4:1/3 | R:0.5 D4:1.5 |');

		expect(notes).toEqual([
			{ pitches: [60], startBeat: 0, beats: 1 / 3, velocity: null, staccato: false },
			{ pitches: [62], startBeat: (1 / 3) + 0.5, beats: 1.5, velocity: null, staccato: false },
		]);
		expect(beats).toBeCloseTo((1 / 3) + 2);
	});

	it('reads per-note velocity and staccato', () => {
		const { notes } = parseTrackNotes('C4:1@110 D4:0.5\' E4+G4:1/2@40\'');

		expect(notes.map(({ velocity, staccato }) => {
			return { velocity, staccato };
		})).toEqual([
			{ velocity: 110, staccato: false },
			{ velocity: null, staccato: true },
			{ velocity: 40, staccato: true },
		]);
	});

	it.each([
		'C4',
		'H4:1',
		'C4:0',
		'C4:-1',
		'C4:1/0',
		'128:1',
		'C4:abc',
		'A9:1',
		'C4:1@0',
		'C4:1@128',
		'R:1@90',
		'R:1\'',
	])('rejects malformed token %s', (notes) => {
		expect(() => parseTrackNotes(notes)).toThrow(SongError);
	});
});

describe('buildSongMidi', () => {
	it('writes a format 1 file with a conductor track plus one track per instrument', () => {
		const { midi } = buildSongMidi(song(
			[track(), track({ name: 'bass', instrument: 33 })],
			[section('verse', 1, [part('lead', 'C4:1'), part('bass', 'C2:1')])],
		));

		expect(midi.subarray(0, 4).toString('ascii')).toBe('MThd');
		expect(midi.readUInt16BE(8)).toBe(1);
		expect(midi.readUInt16BE(10)).toBe(3);
	});

	it('plays drum tracks on the GM percussion channel without a program change', () => {
		const { midi } = buildSongMidi(song([track({ name: 'drums', drums: true, instrument: 5 })], [section('groove', 1, [part('drums', '36:1')])]));

		expect(containsBytes(midi, [0x99, 36, 100])).toBe(true);
		expect(midi.includes(0xC9)).toBe(false);
	});

	it('sets each channel\'s volume, pan, reverb, and chorus before its notes', () => {
		const { midi } = buildSongMidi(song(
			[track({ volume: 90, pan: -100, reverb: 70, chorus: 20 }), track({ name: 'keys', pan: 100 }), track({ name: 'bass', pan: 0 })],
			[section('verse', 1, [part('lead', 'C4:1'), part('keys', 'E4:1'), part('bass', 'C2:1')])],
		));

		expect(containsBytes(midi, [0xB0, 7, 90, 0x00, 0xB0, 10, 0, 0x00, 0xB0, 91, 70, 0x00, 0xB0, 93, 20])).toBe(true);
		expect(containsBytes(midi, [0xB1, 10, 127])).toBe(true);
		expect(containsBytes(midi, [0xB2, 10, 64])).toBe(true);
	});

	it('releases a repeated pitch before retriggering it on the same tick', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 2, [part('lead', 'C4:1 C4:1')])]));

		// delta 480 ticks, note-off C4, then delta 0, note-on C4
		expect(containsBytes(midi, [0x83, 0x60, 0x80, 60, 0, 0x00, 0x90, 60, 100])).toBe(true);
	});

	it('loops each part to fill its section', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 4, [part('lead', 'C4:1')])]));

		expect(countBytes(midi, [0x90, 60, 100])).toBe(4);
	});

	it('cuts a partial last loop at the section end', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 4, [part('lead', 'C4:3')])]));

		// The second loop starts at beat 3 and must stop at beat 4 (480 ticks later), with the track ending there.
		expect([...midi.subarray(-12)]).toEqual([0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0x00, 0xFF, 0x2F, 0x00]);
	});

	it('plays sections in arrangement order, including repeats, for duration', () => {
		const { durationSeconds } = buildSongMidi(song(
			[track()],
			[section('verse', 4, [part('lead', 'C4:4')]), section('chorus', 8, [part('lead', 'G4:8')])],
			{ arrangement: ['verse', 'chorus', 'verse'] },
		));

		expect(durationSeconds).toBe(8);
	});

	it('prefers note velocity over part velocity over track velocity', () => {
		const { midi } = buildSongMidi(song(
			[track({ velocity: 100 })],
			[section('verse', 2, [part('lead', 'C4:1 D4:1@120', 70)]), section('chorus', 1, [part('lead', 'E4:1')])],
		));

		expect(containsBytes(midi, [0x90, 60, 70])).toBe(true);
		expect(containsBytes(midi, [0x90, 62, 120])).toBe(true);
		expect(containsBytes(midi, [0x90, 64, 100])).toBe(true);
	});

	it('shortens staccato notes to half their length', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 2, [part('lead', 'C4:1\' R:1')])]));

		// note-on C4, then note-off 240 ticks later
		expect(containsBytes(midi, [0x90, 60, 100, 0x81, 0x70, 0x80, 60, 0])).toBe(true);
	});

	it('delays off-beat eighths to the triplet position at full swing', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 1, [part('lead', 'C4:0.5 D4:0.5')])], { swing: 1 }));

		// C4 lasts until 2/3 of the beat (320 ticks), where D4 starts.
		expect(containsBytes(midi, [0x90, 60, 100, 0x82, 0x40, 0x80, 60, 0, 0x00, 0x90, 62, 100])).toBe(true);
	});

	it('varies velocity when humanized, identically for the same title', () => {
		const humanized = song([track()], [section('verse', 16, [part('lead', 'C4:1')])], { humanize: 1 });
		const { midi } = buildSongMidi(humanized);

		expect(countBytes(midi, [0x90, 60, 100])).toBeLessThan(16);
		expect(buildSongMidi(humanized).midi.equals(midi)).toBe(true);
	});

	it('extends the conductor track past the music so releases and reverb ring out', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 4, [part('lead', 'C4:4')])]));

		// 4 beats plus a 2 second tail at 120 bpm is 3840 ticks after the tempo event.
		expect(containsBytes(midi, [0x9E, 0x00, 0xFF, 0x2F, 0x00])).toBe(true);
	});

	it('keeps trailing rests by ending the track after them', () => {
		const { midi } = buildSongMidi(song([track()], [section('verse', 4, [part('lead', 'C4:1 R:3')])]));

		// The last note-off lands at beat 1, so end-of-track must follow 3 beats (1440 ticks) later.
		expect([...midi.subarray(-5)]).toEqual([0x8B, 0x20, 0xFF, 0x2F, 0x00]);
	});

	it('warns about likely mistakes without failing', () => {
		const { warnings } = buildSongMidi(song(
			[
				track(),
				track({ name: 'unused' }),
				track({ name: 'kick', drums: true }),
				track({ name: 'hats', drums: true, pan: 30 }),
			],
			[
				section('verse', 4, [part('lead', 'C4:3 C9:1'), part('kick', '36:1'), part('hats', '42:1')]),
				section('bridge', 4, [part('lead', 'C4:4')]),
			],
			{ arrangement: ['verse'] },
		));

		expect(warnings).toEqual([
			expect.stringContaining('Section "bridge" is not in the arrangement'),
			expect.stringContaining('Track "lead" has 1 notes outside the usual instrument range'),
			expect.stringContaining('Track "unused" has no part'),
			expect.stringContaining('"hats" uses the volume, pan, reverb, and chorus of "kick"'),
		]);
	});

	it('warns when a part does not divide its section', () => {
		const { warnings } = buildSongMidi(song([track()], [section('verse', 4, [part('lead', 'C4:3')])]));

		expect(warnings).toEqual([expect.stringContaining('does not divide the 4-beat section')]);
	});

	it.each<[string, Song]>([
		['unknown track', song([track()], [section('verse', 1, [part('bass', 'C2:1')])])],
		['duplicate part', song([track()], [section('verse', 1, [part('lead', 'C4:1'), part('lead', 'E4:1')])])],
		['part longer than its section', song([track()], [section('verse', 2, [part('lead', 'C4:3')])])],
		['empty part', song([track()], [section('verse', 2, [part('lead', '|')])])],
		['unknown arranged section', song([track()], [section('verse', 1, [part('lead', 'C4:1')])], { arrangement: ['chorus'] })],
		['duplicate track', song([track(), track()], [section('verse', 1, [part('lead', 'C4:1')])])],
		['duplicate section', song([track()], [section('verse', 1, [part('lead', 'C4:1')]), section('verse', 1, [part('lead', 'C4:1')])])],
		['only rests', song([track()], [section('verse', 4, [part('lead', 'R:4')])])],
		['over the length limit', song([track()], [section('verse', 256, [part('lead', 'C4:256')])], { arrangement: Array.from({ length: Math.ceil((MAX_SONG_SECONDS * 2) / 256) + 1 }, () => 'verse') })],
	])('rejects a song with %s', (_label, invalid) => {
		expect(() => buildSongMidi(invalid)).toThrow(SongError);
	});
});
