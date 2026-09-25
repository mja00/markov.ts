import { describe, expect, it } from 'vitest';

import {
	MAX_SONG_SECONDS,
	Song,
	SongError,
	SongTrack,
	buildSongMidi,
	parseTrackNotes,
} from '../../../src/services/song.service.js';

const track = (overrides: Partial<SongTrack>): SongTrack => {
	return {
		name: 'lead', instrument: 0, drums: false, velocity: 100, repeat: 1, notes: 'C4:1', ...overrides,
	};
};

const song = (tracks: SongTrack[], bpm = 120): Song => {
	return { title: 'Test', bpm, tracks };
};

const containsBytes = (haystack: Buffer, needle: number[]): boolean => haystack.includes(Buffer.from(needle));

describe('parseTrackNotes', () => {
	it('converts note names, accidentals, MIDI numbers, and chords to pitches', () => {
		const { notes } = parseTrackNotes('C4:1 F#3:1 Bb2:1 36:1 C4+E4+G4:1 C-1:1');

		expect(notes.map(note => note.pitches)).toEqual([[60], [54], [46], [36], [60, 64, 67], [0]]);
	});

	it('advances time across rests, fractions, and bar separators', () => {
		const { notes, beats } = parseTrackNotes('C4:1/3 | R:0.5 D4:1.5 |');

		expect(notes).toEqual([
			{ pitches: [60], startBeat: 0, beats: 1 / 3 },
			{ pitches: [62], startBeat: (1 / 3) + 0.5, beats: 1.5 },
		]);
		expect(beats).toBeCloseTo((1 / 3) + 2);
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
	])('rejects malformed token %s', (notes) => {
		expect(() => parseTrackNotes(notes)).toThrow(SongError);
	});
});

describe('buildSongMidi', () => {
	it('writes a format 1 file with a conductor track plus one track per instrument', () => {
		const { midi } = buildSongMidi(song([track({}), track({ name: 'bass', instrument: 33 })]));

		expect(midi.subarray(0, 4).toString('ascii')).toBe('MThd');
		expect(midi.readUInt16BE(8)).toBe(1);
		expect(midi.readUInt16BE(10)).toBe(3);
		expect(midi.readUInt16BE(12)).toBe(480);
	});

	it('plays drum tracks on the GM percussion channel without a program change', () => {
		const { midi } = buildSongMidi(song([track({ drums: true, instrument: 5, notes: '36:1' })]));

		expect(containsBytes(midi, [0x99, 36, 100])).toBe(true);
		expect(midi.includes(0xC9)).toBe(false);
	});

	it('releases a repeated pitch before retriggering it on the same tick', () => {
		const { midi } = buildSongMidi(song([track({ notes: 'C4:1 C4:1' })]));

		// delta 480 ticks, note-off C4, then delta 0, note-on C4
		expect(containsBytes(midi, [0x83, 0x60, 0x80, 60, 0, 0x00, 0x90, 60, 100])).toBe(true);
	});

	it('uses the longest repeated track for duration', () => {
		const { durationSeconds } = buildSongMidi(song([
			track({ notes: 'C4:4' }),
			track({ notes: '36:1', drums: true, repeat: 8 }),
		], 120));

		expect(durationSeconds).toBe(4);
	});

	it('rejects songs over the length limit', () => {
		const beatsOverLimit = ((MAX_SONG_SECONDS * 120) / 60) + 1;

		expect(() => buildSongMidi(song([track({ notes: `C4:${beatsOverLimit}` })], 120))).toThrow(SongError);
	});

	it('rejects songs with only rests', () => {
		expect(() => buildSongMidi(song([track({ notes: 'R:4' })]))).toThrow(SongError);
	});
});
