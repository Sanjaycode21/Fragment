import type { Caption, CaptionStyle, ClipRange } from './captions';
import type { Highlight } from './highlights';

export type MediaJob = { file: File; range: ClipRange } & (
  | { kind: 'transcribe'; cpu?: boolean }
  | { kind: 'highlights'; auto?: boolean; measureAudioDuration?: boolean }
  | { kind: 'export'; captions: Caption[]; style: CaptionStyle; width: number; height: number }
);

export type MediaMessage =
  | { kind: 'progress'; label: string; percent?: number }
  | { kind: 'transcript'; captions: Caption[] }
  | { kind: 'highlights'; highlights: Highlight[] }
  | { kind: 'mp4'; buffer: ArrayBuffer }
  | { kind: 'error'; message: string; retryOnCPU?: boolean };

export type ReportProgress = (label: string, percent?: number) => void;
