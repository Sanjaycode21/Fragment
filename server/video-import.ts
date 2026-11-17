import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { parseVideoLink } from '../src/video-link.ts';
import type { ClipRange } from '../src/captions.ts';

const maxSize = 200 * 1024 * 1024;
const endpoint = '/api/video-import';
const transferSize = 512 * 1024;
const jobs = new Map<string, ImportJob>();

type ImportJob = {
  controller: AbortController;
  directory?: string;
  timeout?: NodeJS.Timeout;
  result?: { output: string; size: number; type: string };
  error?: string;
};

function download(url: string, output: string, range: ClipRange | null, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const python = process.env.FRAGMENT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const entry = range ? ['-c', [
      'import sys',
      'from imageio_ffmpeg import get_ffmpeg_exe',
      'from yt_dlp import main',
      'main(["--ffmpeg-location", get_ffmpeg_exe(), *sys.argv[1:]])',
    ].join('\n')] : ['-m', 'yt_dlp'];
    const format = range
      ? ['--format', 'b[height<=720][ext=mp4]/b[ext=mp4]/bv[height<=720][ext=mp4]+ba[ext=m4a]',
        '--merge-output-format', 'mp4', '--download-sections', '*' + range.start + '-' + range.end,
        '--force-keyframes-at-cuts']
      : ['--format', 'worstaudio[ext=m4a]/worstaudio[ext=webm]/b[ext=mp4]', '--max-filesize', String(maxSize)];
    const child = spawn(python, [...entry,
      '--ignore-config', '--no-playlist', '--no-plugin-dirs', '--no-cache-dir',
      '--js-runtimes', 'node:' + process.execPath, '--socket-timeout', '20',
      '--retries', '1', '--fragment-retries', '0', '--match-filter', '!is_live',
      '--no-progress', ...format,
      '--output', output, '--', url,
    ], { signal, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let details = '';
    let spawnError: Error | undefined;
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => { details = (details + chunk).slice(-4000); });
    child.once('error', error => { spawnError = error; });
    child.once('close', code => {
      if (signal.aborted) return reject(new Error('The source request was interrupted or timed out.'));
      if (spawnError || /No module named yt_dlp/i.test(details)) {
        return reject(new Error('The local downloader is missing. Install yt-dlp using the setup command in the README.'));
      }
      if (/No module named imageio_ffmpeg|No ffmpeg exe|ffmpeg could not be found/i.test(details)) {
        return reject(new Error('FFmpeg is needed to fetch the selected clip. Install imageio-ffmpeg using the README.'));
      }
      if (code !== 0) {
        console.warn('Video import failed:', details.trim());
        if (/sign.?in|login|bot|private|restricted|403|429/i.test(details)) {
          return reject(new Error('The platform blocked public access to this video from the local downloader.'));
        }
        return reject(new Error('The downloader could not open a compatible video at this link.'));
      }
      resolve();
    });
  });
}

function json(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, error: string) {
  json(res, status, { error });
}

async function removeJob(id: string, job: ImportJob) {
  jobs.delete(id);
  clearTimeout(job.timeout);
  job.controller.abort();
  if (job.directory) await rm(job.directory, { recursive: true, force: true }).catch(console.error);
}

async function handleImport(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return jsonError(res, 405, 'Send a video URL as JSON.');
  }

  let requested: { url?: unknown; range?: unknown } | null;
  try {
    let body = '';
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      body += String(chunk);
      if (body.length > 2048) return jsonError(res, 413, 'This video link is too long.');
    }
    requested = JSON.parse(body);
  } catch {
    return jsonError(res, 400, 'Enter a valid video link.');
  }
  const video = typeof requested?.url === 'string' ? parseVideoLink(requested.url) : null;
  if (!video) return jsonError(res, 400, 'Enter a YouTube, Instagram, or TikTok video link.');

  let range: ClipRange | null = null;
  if (requested?.range !== undefined) {
    const candidate = requested.range as Partial<ClipRange> | null;
    if (typeof candidate?.start !== 'number' || typeof candidate.end !== 'number'
      || !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end)
      || candidate.start < 0 || candidate.end <= candidate.start || candidate.end - candidate.start > 35) {
      return jsonError(res, 400, 'Choose a valid clip up to 35 seconds long.');
    }
    range = { start: candidate.start, end: candidate.end };
  }

  const id = randomUUID();
  const job: ImportJob = { controller: new AbortController() };
  jobs.set(id, job);
  json(res, 202, { id });
  void prepareImport(id, job, video.url, range);
}

async function prepareImport(id: string, job: ImportJob, url: string, range: ClipRange | null) {
  const timeout = setTimeout(() => job.controller.abort(), 240_000);
  try {
    const directory = await mkdtemp(join(tmpdir(), 'fragment-video-'));
    job.directory = directory;
    job.controller.signal.throwIfAborted();
    await download(url, join(directory, 'source.%(ext)s'), range, job.controller.signal);
    const name = (await readdir(directory)).find(item => /^source\.(?:m4a|webm|mp4)$/.test(item));
    if (!name || (range && name !== 'source.mp4')) throw new Error(range
      ? 'The platform did not return the selected MP4 segment.'
      : 'The platform did not return usable audio for highlight detection.');
    const output = join(directory, name);
    const file = await stat(output);
    if (!file.size || file.size > maxSize) throw new Error('The requested media is empty or exceeds the local processing limit.');
    job.result = { output, size: file.size, type: range ? 'video/mp4' : 'application/octet-stream' };
  } catch (error) {
    job.error = error instanceof Error ? error.message : 'The source could not be imported.';
  } finally {
    clearTimeout(timeout);
    if (!jobs.has(id)) {
      if (job.directory) await rm(job.directory, { recursive: true, force: true }).catch(console.error);
    } else {
      job.timeout = setTimeout(() => { void removeJob(id, job); }, 5 * 60_000);
      job.timeout.unref();
    }
  }
}

async function handleJob(req: IncomingMessage, res: ServerResponse, id: string, offset: string | null) {
  const job = jobs.get(id);
  if (!job) return jsonError(res, 404, 'This import expired. Generate the clip again.');
  if (req.method === 'DELETE') {
    if (job.result || job.error) await removeJob(id, job);
    else {
      jobs.delete(id);
      job.controller.abort();
    }
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET') return jsonError(res, 405, 'Use GET to check this import.');
  if (job.error) return jsonError(res, 502, job.error);
  if (!job.result) return json(res, 202, { state: 'preparing' });
  const { size, output, type } = job.result;
  if (offset === null) return json(res, 200, { size, type, transferSize });
  const start = Number(offset);
  if (!/^\d+$/.test(offset) || !Number.isSafeInteger(start) || start >= size) return jsonError(res, 416, 'Invalid media offset.');
  const end = Math.min(start + transferSize, size) - 1;
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-store',
  });
  await pipeline(createReadStream(output, { start, end }), res);
}

export function videoImport(): Plugin {
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const id = url.pathname.startsWith(endpoint + '/') ? url.pathname.slice(endpoint.length + 1) : null;
      if (url.pathname !== endpoint && id === null) return next();
      const host = req.headers.host ?? '';
      const origin = req.headers.origin;
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
        || (req.method !== 'GET' || origin) && origin !== 'http://' + host
        || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
        return jsonError(res, 403, 'Link import is available from the local Fragment app.');
      }
      const task = id === null ? handleImport(req, res) : handleJob(req, res, id, url.searchParams.get('offset'));
      void task.catch(() => {
        if (!res.headersSent && !res.destroyed) jsonError(res, 500, 'The video import service stopped.');
      });
    });
  };
  return { name: 'fragment-video-import', configureServer: configure, configurePreviewServer: configure };
}
