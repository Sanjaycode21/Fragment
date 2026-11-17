import assert from 'node:assert/strict';
import test from 'node:test';
import { clipCaptions, formatSubtitles, frameSize } from '../src/captions.ts';
import type { Caption } from '../src/captions.ts';

const captions: Caption[] = [
  { id: 'late', start: 14.25, end: 18, text: 'Last line' },
  { id: 'early', start: 8, end: 11.5, text: 'First line' },
  { id: 'before', start: 4, end: 10, text: 'Outside the clip' },
  { id: 'after', start: 15, end: 19, text: 'Outside the clip' },
];
const range = { start: 10, end: 15 };

test('includes only overlapping cues and clips both boundaries without changing source timing', () => {
  const clipped = clipCaptions(captions, range);
  assert.deepEqual(clipped.map(({ id, start, end }) => [id, start, end]), [
    ['early', 0, 1.5], ['late', 4.25, 5],
  ]);
  assert.equal(captions[1].start, 8);
  assert.equal(captions[0].end, 18);
});

test('uses clip-relative SRT and VTT timestamps with valid cue separators', () => {
  assert.equal(formatSubtitles(captions, range, 'srt'),
    '1\n00:00:00,000 --> 00:00:01,500\nFirst line\n\n2\n00:00:04,250 --> 00:00:05,000\nLast line\n');
  assert.equal(formatSubtitles(captions, range, 'vtt'),
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nFirst line\n\n00:00:04.250 --> 00:00:05.000\nLast line\n');
});

test('preserves literal markup characters and removes empty lines and blank cues', () => {
  const input = [
    { id: 'a', start: 0, end: 1, text: ' A < B & C > D \n\n Next line ' },
    { id: 'b', start: 1, end: 2, text: '   ' },
  ];
  assert.equal(formatSubtitles(input, { start: 0, end: 2 }, 'vtt'),
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA &lt; B &amp; C &gt; D\nNext line\n');
});

test('chooses even export dimensions for original and center-cropped video', () => {
  assert.deepEqual(frameSize(3840, 2160, 'source'), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize(3840, 2160, '9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(frameSize(1920, 1080, '1:1'), { width: 1080, height: 1080 });
});
