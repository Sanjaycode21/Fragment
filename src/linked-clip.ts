import type { ClipRange } from './captions';
import type { MediaJob, MediaMessage } from './media-job';

function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function readWithRetry<T>(read: () => Promise<T>, signal: AbortSignal, error: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (cause) {
      signal.throwIfAborted();
      if (!(cause instanceof TypeError)) throw cause;
      if (attempt === 2) throw new Error(error, { cause });
      await pause(500 * (attempt + 1), signal);
    }
  }
}

async function fetchMedia(url: string, signal: AbortSignal, range?: ClipRange) {
  const endpoint = '/api/video-import';
  const stage = range ? 'video segment' : 'source audio';
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, range }),
      signal,
    });
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error('Could not reach the local Fragment server to request the ' + stage + '.', { cause });
  }
  const result = await response.json().catch(() => null);
  if (response.status !== 202 || typeof result?.id !== 'string') {
    throw new Error(result?.error || 'Link import requires the local Fragment server. Start it with npm run dev.');
  }
  const jobUrl = endpoint + '/' + encodeURIComponent(result.id);
  const interrupted = 'The ' + stage + ' transfer was interrupted. Try Generate clip again.';
  try {
    let status: Response;
    do {
      status = await readWithRetry(() => fetch(jobUrl, { signal }), signal, interrupted);
      if (status.status === 202) {
        await status.body?.cancel();
        await pause(1000, signal);
      }
    } while (status.status === 202);
    const info = await status.json().catch(() => null);
    if (!status.ok || !info?.size || !info?.transferSize) throw new Error(info?.error || interrupted);
    const parts: ArrayBuffer[] = [];
    for (let offset = 0; offset < info.size; offset += info.transferSize) {
      const length = Math.min(info.transferSize, info.size - offset);
      const part = await readWithRetry(async () => {
        const chunk = await fetch(jobUrl + '?offset=' + offset, { signal });
        if (chunk.status === 404) throw new Error('This import expired. Generate the clip again.');
        if (!chunk.ok) throw new TypeError('Chunk request failed.');
        const buffer = await chunk.arrayBuffer();
        if (buffer.byteLength !== length) throw new TypeError('Incomplete media chunk.');
        return buffer;
      }, signal, interrupted);
      parts.push(part);
    }
    return new Blob(parts, { type: info.type });
  } finally {
    void fetch(jobUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
}

function analyzeLinkAudio(audio: Blob, signal: AbortSignal, progress: (label: string) => void) {
  signal.throwIfAborted();
  return new Promise<ClipRange>((resolve, reject) => {
    const worker = new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' });
    function cleanup() {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    }
    function abort() {
      cleanup();
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<MediaMessage>) => {
      if (data.kind === 'progress') {
        progress(data.percent === undefined ? data.label : data.label + ' · ' + data.percent + '%');
      } else if (data.kind === 'highlights') {
        cleanup();
        const best = data.highlights[0];
        if (best) resolve({ start: best.start, end: best.end });
        else reject(new Error('No standout audio peaks were found in this video.'));
      } else if (data.kind === 'error') {
        cleanup();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('The audio analysis worker stopped.'));
    };
    worker.postMessage({
      kind: 'highlights', auto: true, measureAudioDuration: true,
      file: new File([audio], 'linked-audio'), range: { start: 0, end: 0 },
    } satisfies MediaJob);
  });
}

export async function generateLinkedClip(
  source: { url: string; name: string },
  signal: AbortSignal,
  progress: (label: string) => void,
) {
  progress('Fetching audio for highlight detection…');
  const audio = await fetchMedia(source.url, signal);
  progress('Finding highlights…');
  const range = await analyzeLinkAudio(audio, signal, progress);
  progress('Fetching the selected video segment…');
  const clip = await fetchMedia(source.url, signal, range);
  return new File([clip], source.name + '.mp4', { type: 'video/mp4' });
}
