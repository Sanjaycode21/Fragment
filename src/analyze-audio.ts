import type { AudioSampleSink } from 'mediabunny';
import { audioHighlights } from './highlights';
import type { ReportProgress } from './media-job';

export async function analyzeAudio(sink: AudioSampleSink, duration: number, report: ReportProgress) {
  const counts = new Uint32Array(Math.ceil(duration * 2));
  const energy = new Float64Array(counts.length);
  let nextProgress = 0;
  for await (const sample of sink.samples(0, duration)) {
    try {
      const { timestamp, sampleRate, numberOfChannels, numberOfFrames } = sample;
      const values = new Float32Array(numberOfChannels * numberOfFrames);
      sample.copyTo(values, { planeIndex: 0, format: 'f32' });
      const stride = Math.max(1, Math.floor(sampleRate / 4000));
      for (let frame = 0; frame < numberOfFrames; frame += stride) {
        const bucket = Math.floor((timestamp + frame / sampleRate) * 2);
        if (bucket < 0 || bucket >= counts.length) continue;
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const value = values[frame * numberOfChannels + channel];
          energy[bucket] += value * value;
          counts[bucket]++;
        }
      }
      const percent = Math.min(100, Math.floor(timestamp / duration * 100));
      if (percent >= nextProgress) {
        report('Finding audio highlights', percent);
        nextProgress = percent + 2;
      }
    } finally {
      sample.close();
    }
  }
  return audioHighlights(Array.from(energy, (sum, i) => Math.sqrt(sum / (counts[i] || 1))), duration);
}
