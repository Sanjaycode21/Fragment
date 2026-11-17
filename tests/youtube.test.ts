import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYouTubeLink } from '../src/youtube.ts';

test('supports YouTube watch, share, Shorts and embed links with optional timestamps', () => {
  const id = 'M7lc1UVf-VE';
  assert.deepEqual(parseYouTubeLink('https://www.youtube.com/watch?v=' + id), { id, start: 0 });
  assert.deepEqual(parseYouTubeLink('youtu.be/' + id + '?t=1m20s'), { id, start: 80 });
  assert.deepEqual(parseYouTubeLink('https://m.youtube.com/shorts/' + id + '?t=15'), { id, start: 15 });
  assert.deepEqual(parseYouTubeLink('https://youtube.com/embed/' + id + '?start=10'), { id, start: 10 });
});

test('rejects non-video links and impersonating domains', () => {
  for (const url of [
    'https://youtube.com.evil.example/watch?v=M7lc1UVf-VE',
    'https://youtube.com@evil.example/watch?v=M7lc1UVf-VE',
    'https://youtube.com/playlist?list=some-list',
    'https://youtu.be/invalid',
    'javascript:alert(1)',
  ]) assert.equal(parseYouTubeLink(url), null);
});
