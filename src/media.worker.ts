import {
  ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, Conversion,
  Input, Mp4OutputFormat, Output, QUALITY_HIGH,
} from 'mediabunny';
import { clipCaptions } from './captions';
import { drawCaptions } from './caption-canvas';
import { analyzeAudio } from './analyze-audio';
import type { MediaJob, MediaMessage } from './media-job';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: MediaMessage) => worker.postMessage(message);

async function hasWebGPU() {
  const gpu = (navigator as WorkerNavigator & {
    gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean } } | null> };
  }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  return Boolean(adapter && !adapter.info?.isFallbackAdapter);
}

worker.onmessage = async ({ data }: MessageEvent<MediaJob>) => {
  const input = new Input({ source: new BlobSource(data.file), formats: ALL_FORMATS });
  const progress = (label: string, percent?: number) => send({ kind: 'progress', label, percent });
  try {
    if (data.kind === 'highlights') {
      progress('Checking audio track');
      const audio = await input.getPrimaryAudioTrack();
      if (!audio || !(await audio.canDecode())) throw new Error('A decodable audio track is needed to find audio highlights.');
      const duration = data.measureAudioDuration ? await audio.computeDuration() : data.range.end;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source has no usable audio duration.');
      const highlights = await analyzeAudio(new AudioSampleSink(audio), duration, progress);
      if (!highlights.length && data.auto && duration <= 35) {
        highlights.push({ start: 0, end: duration, reason: 'Short source video', score: 0 });
      }
      send({ kind: 'highlights', highlights });
      return;
    }
    if (data.kind === 'transcribe') {
      if (typeof WebAssembly === 'undefined') throw new Error('Automatic captions require WebAssembly in this browser.');
      progress('Checking audio track');
      const audio = await input.getPrimaryAudioTrack();
      if (!audio) throw new Error('This video has no audio track. You can still add captions manually.');
      if (!(await audio.canDecode())) throw new Error('This browser cannot decode the audio track. Try an MP4 with AAC audio.');
      const { InferenceError, transcribe } = await import('./transcribe');
      const device = !data.cpu && await hasWebGPU() ? 'webgpu' : 'wasm';
      try {
        const captions = await transcribe(new AudioSampleSink(audio), data.range, device, progress);
        send({ kind: 'transcript', captions });
      } catch (error) {
        if (device === 'webgpu' && error instanceof InferenceError) {
          send({ kind: 'error', message: error.message, retryOnCPU: true });
          return;
        }
        throw error;
      }
      return;
    }

    progress('Preparing MP4');
    if (typeof OffscreenCanvas === 'undefined' || typeof VideoEncoder === 'undefined') {
      throw new Error('MP4 export needs Canvas and WebCodecs support. Try a current version of Chrome or Edge.');
    }
    const canvas = new OffscreenCanvas(data.width, data.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not open the export canvas. Try closing other tabs.');
    const cues = clipCaptions(data.captions, data.range);
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: data.range,
      showWarnings: false,
      audio: { codec: 'aac', forceTranscode: true },
      video: {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        width: data.width,
        height: data.height,
        fit: 'cover',
        process(frame) {
          frame.draw(ctx, 0, 0, canvas.width, canvas.height);
          drawCaptions(ctx, cues, frame.timestamp, data.style);
          return canvas;
        },
      },
    });

    if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')
      || !conversion.utilizedTracks.some(track => track.isVideoTrack())) {
      throw new Error('This browser cannot convert the video and audio to H.264/AAC MP4. Try Chrome or Edge and a supported source file.');
    }
    conversion.onProgress = value => progress('Rendering MP4', Math.round(value * 100));
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The video encoder did not produce an MP4.');
    worker.postMessage({ kind: 'mp4', buffer } satisfies MediaMessage, [buffer]);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'The browser could not process this clip.';
    const resourceError = /out of memory|allocation failed|quota exceeded/i.test(message);
    send({
      kind: 'error',
      message: resourceError ? 'The browser ran out of resources. Try a shorter clip or close other tabs.' : message,
    });
  } finally {
    input.dispose();
  }
};
