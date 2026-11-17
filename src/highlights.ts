import type { ClipRange } from './captions';

export type Highlight = ClipRange & { reason: string; score: number };

function rank(candidates: Highlight[]) {
  const picked: Highlight[] = [];
  for (const item of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (picked.some(other => item.start < other.end && item.end > other.start)) continue;
    picked.push(item);
    if (picked.length === 5) break;
  }
  return picked;
}

export function audioHighlights(levels: number[], duration: number) {
  const baseline = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.6)] ?? 0;
  const candidates: Highlight[] = [];
  for (let index = 0; index < levels.length; index++) {
    const peak = levels[index];
    if (peak < 0.012 || peak < baseline * 1.35 || peak < (levels[index - 1] ?? 0) || peak < (levels[index + 1] ?? 0)) continue;
    const start = Math.max(0, index * 0.5 - 5);
    const end = Math.min(duration, start + 22);
    if (end - start >= Math.min(3, duration)) {
      candidates.push({ start, end, score: peak / Math.max(0.012, baseline), reason: 'Audio energy peak' });
    }
  }
  return rank(candidates);
}

const cueTime = '(?:\\d{2,}:)?\\d{2}:\\d{2}[.,]\\d{3}';
const cueLine = new RegExp('^(' + cueTime + ')\\s+-->\\s+(' + cueTime + ')(?:\\s|$)');

function seconds(value: string) {
  return value.replace(',', '.').split(':').reduce((time, unit) => time * 60 + Number(unit), 0);
}

export function transcriptHighlights(contents: string) {
  const cues = contents.trim().split(/\r?\n\s*\r?\n/).flatMap(block => {
    const lines = block.trim().split(/\r?\n/);
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) return [];
    const timingIndex = lines.findIndex(line => cueLine.test(line));
    if (timingIndex < 0 || timingIndex > 1) return [];
    const match = lines[timingIndex].match(cueLine)!;
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    return Number.isFinite(end) && end > start && text ? [{ start, end, text }] : [];
  }).sort((a, b) => a.start - b.start);
  const candidates: Highlight[] = [];
  const dialogue: Highlight[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const question = cue.text.includes('?');
    const reaction = /!|\b(watch this|no way|I can't believe|here's why|look at that)\b/i.test(cue.text);
    let end = Math.min(cue.end, cue.start + 28);
    let textLength = cue.text.replace(/\s/g, '').length;
    for (let next = i + 1; next < cues.length; next++) {
      const following = cues[next];
      if (following.start > end + 4 || following.end > cue.start + 28) break;
      end = Math.max(end, following.end);
      textLength += following.text.replace(/\s/g, '').length;
    }
    if (question || reaction) {
      candidates.push({
        start: cue.start, end, score: (question ? 2 : 3) + Math.min(end - cue.start, 20) / 20,
        reason: question ? 'Question and nearby dialogue' : 'Reaction in transcript',
      });
    } else if (textLength >= 30) {
      dialogue.push({ start: cue.start, end, score: textLength, reason: 'Continuous dialogue' });
    }
  }
  return { cueCount: cues.length, highlights: rank(candidates.length ? candidates : dialogue) };
}
