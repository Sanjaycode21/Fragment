import assert from 'node:assert/strict';
import test from 'node:test';
import { audioHighlights, transcriptHighlights } from '../src/highlights.ts';

test('ranks separated audio peaks and skips silence or uniform loudness', () => {
  const levels = new Array(180).fill(0.02);
  levels[40] = 0.5;
  levels[46] = 0.4;
  levels[115] = 0.3;
  assert.deepEqual(audioHighlights(levels, 90).map(({ start, end }) => [start, end]), [[15, 37], [52.5, 74.5]]);
  assert.deepEqual(audioHighlights(new Array(60).fill(0.08), 30), []);
  assert.deepEqual(audioHighlights(new Array(60).fill(0), 30), []);
});

test('groups a transcript hook with nearby dialogue and stops at a gap', () => {
  const contents = 'WEBVTT\n\n00:04.000 --> 00:06.000\nWhat happens next?\n\n00:06.500 --> 00:10.000\nHere is the answer.\n\n00:20.000 --> 00:25.000\nA separate scene.\n';
  const { cueCount, highlights } = transcriptHighlights(contents);
  assert.equal(cueCount, 3);
  assert.deepEqual(highlights.map(({ start, end }) => [start, end]), [[4, 10]]);
});

test('uses continuous dialogue as a fallback and rejects unstructured text', () => {
  const contents = '1\n00:00:16,000 --> 00:00:22,000\nThis is a complete thought with enough dialogue to preview.';
  assert.equal(transcriptHighlights(contents).highlights[0]?.reason, 'Continuous dialogue');
  assert.deepEqual(transcriptHighlights('text without timestamps').highlights, []);
});
