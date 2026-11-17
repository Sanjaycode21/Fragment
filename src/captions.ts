export interface ClipRange {
  start: number;
  end: number;
}

export interface Caption extends ClipRange {
  id: string;
  text: string;
}

export interface CaptionStyle {
  size: number;
  color: string;
  outline: boolean;
  background: boolean;
  weight: number;
  horizontal: number;
  vertical: number;
}

export const presets = {
  Clean: { size: 4.5, color: '#ffffff', outline: false, background: true, weight: 500, horizontal: 50, vertical: 84 },
  Bold: { size: 6, color: '#ffffff', outline: true, background: false, weight: 800, horizontal: 50, vertical: 82 },
  Gaming: { size: 6, color: '#e1ff76', outline: true, background: false, weight: 900, horizontal: 50, vertical: 75 },
} satisfies Record<string, CaptionStyle>;

export function clipCaptions(captions: Caption[], range: ClipRange): Caption[] {
  return captions
    .filter(({ start, end }) => start < range.end && end > range.start && end > start)
    .map(caption => ({
      ...caption,
      start: Math.max(caption.start, range.start) - range.start,
      end: Math.min(caption.end, range.end) - range.start,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function timestamp(ms: number, separator: string) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':')
    + separator + String(ms % 1000).padStart(3, '0');
}

export function formatSubtitles(captions: Caption[], range: ClipRange, format: 'srt' | 'vtt') {
  const blocks: string[] = [];
  const separator = format === 'srt' ? ',' : '.';
  for (const cue of clipCaptions(captions, range)) {
    const start = Math.round(cue.start * 1000);
    const end = Math.round(cue.end * 1000);
    const content = cue.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    if (!content || end <= start) continue;
    const index = format === 'srt' ? (blocks.length + 1) + '\n' : '';
    blocks.push(index + timestamp(start, separator) + ' --> ' + timestamp(end, separator) + '\n' + content);
  }
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + (blocks.length ? blocks.join('\n\n') + '\n' : '');
}

export function displayTime(value: number) {
  const tenths = Math.floor(Math.max(0, value) * 10 + 1e-6);
  const minutes = Math.floor(tenths / 600);
  const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
  return minutes + ':' + seconds + '.' + (tenths % 10);
}

export type Aspect = 'source' | '16:9' | '9:16' | '1:1';

export function frameSize(width: number, height: number, aspect: Aspect) {
  const ratio = aspect === 'source' ? width / height : { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }[aspect];
  const cropWidth = Math.min(width, height * ratio);
  const cropHeight = Math.min(height, width / ratio);
  const scale = Math.min(1, 1920 / Math.max(cropWidth, cropHeight));
  return {
    width: Math.max(2, Math.round(cropWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(cropHeight * scale / 2) * 2),
  };
}
