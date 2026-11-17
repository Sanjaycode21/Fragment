import { env, pipeline } from '@huggingface/transformers';
import type { AudioSampleSink } from 'mediabunny';
import type { Caption, ClipRange } from './captions';
import type { ReportProgress } from './media-job';

const SAMPLE_RATE = 16_000;
const WINDOW = 24;
const CONTEXT = 2;
const MODEL = 'onnx-community/whisper-tiny';
const MODEL_REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';

// Match the JSEP build packaged with this Transformers.js release.
const wasm = new URL('../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url);
const mjs = new URL('../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url);
env.allowLocalModels = false;
env.useBrowserCache = typeof caches !== 'undefined';
Object.assign(env.backends.onnx!.wasm!, {
  wasmPaths: { wasm: wasm.href, mjs: mjs.href },
  numThreads: 1,
  proxy: false,
});

async function extractAudio(sink: AudioSampleSink, start: number, end: number) {
  const output = new Float32Array(Math.ceil((end - start) * SAMPLE_RATE));
  for await (const sample of sink.samples(Math.max(0, start - 0.1), end)) {
    try {
      const { timestamp, numberOfFrames, numberOfChannels, sampleRate } = sample;
      const pcm = new Float32Array(numberOfFrames * numberOfChannels);
      sample.copyTo(pcm, { planeIndex: 0, format: 'f32' });
      const first = Math.max(0, Math.ceil((timestamp - start) * SAMPLE_RATE - 1e-6));
      const last = Math.min(output.length, Math.ceil((timestamp + numberOfFrames / sampleRate - start) * SAMPLE_RATE - 1e-6));
      const factor = sampleRate / SAMPLE_RATE;
      for (let index = first; index < last; index++) {
        const source = (start - timestamp) * sampleRate + index * factor;
        const from = Math.max(0, Math.floor(source));
        const to = Math.min(numberOfFrames, Math.max(from + 1, Math.floor(source + factor)));
        let sum = 0;
        for (let frame = from; frame < to; frame++) {
          for (let channel = 0; channel < numberOfChannels; channel++) sum += pcm[frame * numberOfChannels + channel];
        }
        if (to > from) output[index] = sum / ((to - from) * numberOfChannels);
      }
    } finally {
      sample.close();
    }
  }
  return output;
}

export class InferenceError extends Error {}

export async function transcribe(
  sink: AudioSampleSink,
  range: ClipRange,
  device: 'webgpu' | 'wasm',
  report: ReportProgress,
): Promise<Caption[]> {
  const label = device === 'webgpu' ? 'WebGPU' : 'CPU';
  const downloads = new Map<string, { loaded: number; total: number }>();
  report('Loading Whisper (' + label + ')');
  const recognizer = await pipeline('automatic-speech-recognition', MODEL, {
    revision: MODEL_REVISION,
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback(event) {
      if (event.status !== 'progress' || !event.total) return;
      downloads.set(event.file, { loaded: event.loaded, total: event.total });
      let loaded = 0;
      let total = 0;
      for (const file of downloads.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      report('Downloading Whisper (' + label + ')', Math.min(99, Math.floor(100 * loaded / total)));
    },
  }).catch((error: unknown) => {
    throw new InferenceError('Whisper could not load. Check your connection or try a device with more available memory.', { cause: error });
  });

  const cues: Caption[] = [];
  let hasAudio = false;
  try {
    for (let coreStart = range.start; coreStart < range.end; coreStart += WINDOW) {
      const coreEnd = Math.min(range.end, coreStart + WINDOW);
      const start = Math.max(range.start, coreStart - CONTEXT);
      const end = Math.min(range.end, coreEnd + CONTEXT);
      report('Transcribing selected clip (' + label + ')', Math.round((coreStart - range.start) / (range.end - range.start) * 100));
      const audio = await extractAudio(sink, start, end);
      if (!audio.some(value => Math.abs(value) > 0.001)) continue;
      hasAudio = true;
      const result = await recognizer(audio, {
        return_timestamps: true,
        language: 'en',
        task: 'transcribe',
        max_new_tokens: 224,
      }).catch((error: unknown) => {
        throw new InferenceError('Transcription ran out of resources or the model failed. Try a shorter clip or close other tabs.', { cause: error });
      });
      if (Array.isArray(result)) throw new InferenceError('Whisper returned an unexpected transcript.');
      for (const chunk of result.chunks ?? []) {
        const [from, to] = chunk.timestamp;
        const text = chunk.text.trim();
        if (!text || from == null || !Number.isFinite(from) || (to != null && !Number.isFinite(to))) continue;
        const cueStart = Math.max(start, start + from);
        const cueEnd = Math.min(end, to == null ? end : start + to);
        const center = (cueStart + cueEnd) / 2;
        if (center < coreStart || center >= coreEnd || cueEnd <= cueStart) continue;
        const previous = cues.at(-1);
        if (previous && previous.end > cueStart && previous.text === text) {
          previous.end = Math.max(previous.end, cueEnd);
          continue;
        }
        const nonoverlappingStart = Math.max(cueStart, previous?.end ?? range.start);
        if (cueEnd > nonoverlappingStart) {
          cues.push({ id: crypto.randomUUID(), text, start: nonoverlappingStart, end: cueEnd });
        }
      }
    }
    if (device === 'webgpu' && hasAudio && !cues.length) {
      throw new InferenceError('WebGPU produced no timestamped captions.');
    }
    report('Transcription complete', 100);
    return cues;
  } finally {
    await recognizer.dispose().catch(() => {});
  }
}
