import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoLink } from '../src/video-link.ts';

test('normalizes individual platform links for local import', () => {
  assert.equal(parseVideoLink('https://youtu.be/q6fgVVmdpgY?si=tracking')?.url, 'https://www.youtube.com/watch?v=q6fgVVmdpgY');
  assert.equal(parseVideoLink('https://instagram.com/reel/AbCdEF12/?igsh=tracking')?.url, 'https://www.instagram.com/reel/AbCdEF12/');
  assert.equal(parseVideoLink('https://vm.tiktok.com/Zabcde/')?.url, 'https://vm.tiktok.com/Zabcde/');
});

test('rejects unsupported protocols, hosts, ports and non-video endpoints', () => {
  for (const link of [
    'https://www.instagram.com.example.com/reel/AbCdEF12/',
    'https://www.instagram.com:9/reel/AbCdEF12/',
    'https://www.tiktok.com/@author',
    'http://127.0.0.1:9000/example.mp4',
    'file:///example.mp4',
  ]) assert.equal(parseVideoLink(link), null);
});
