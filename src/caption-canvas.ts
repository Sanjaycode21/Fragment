import type { Caption, CaptionStyle } from './captions';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function wrap(ctx: Context, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function drawCaptions(ctx: Context, captions: Caption[], time: number, style: CaptionStyle) {
  const text = captions.filter(cue => cue.start <= time && cue.end > time && cue.text.trim())
    .map(cue => cue.text.trim()).join('\n');
  if (!text) return;

  const { width, height } = ctx.canvas;
  const maxWidth = width * 0.88;
  let fontSize = Math.min(width, height) * style.size / 100;
  ctx.save();
  const setFont = () => {
    ctx.font = style.weight + ' ' + fontSize + 'px system-ui, sans-serif';
  };
  setFont();
  let lines = wrap(ctx, text, maxWidth);
  while (fontSize > 1 && lines.length * fontSize * 1.2 > height * 0.82) {
    fontSize *= 0.85;
    setFont();
    lines = wrap(ctx, text, maxWidth);
  }
  const lineHeight = fontSize * 1.2;
  const pad = fontSize * 0.24;
  const halfHeight = lines.length * lineHeight / 2;
  const lineWidths = lines.map(line => Math.min(maxWidth, ctx.measureText(line).width));
  const halfWidth = lineWidths.reduce((max, width) => Math.max(max, width / 2), 0);
  const x = Math.max(halfWidth + pad, Math.min(width * style.horizontal / 100, width - halfWidth - pad));
  const y = Math.max(halfHeight + pad, Math.min(height * style.vertical / 100, height - halfHeight - pad));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1, fontSize * 0.13);
  lines.forEach((line, index) => {
    const baseline = y - halfHeight + (index + 0.5) * lineHeight;
    if (style.background) {
      const boxWidth = lineWidths[index] + 2 * pad;
      ctx.fillStyle = 'rgba(12, 12, 12, .76)';
      ctx.beginPath();
      ctx.roundRect(x - boxWidth / 2, baseline - lineHeight / 2, boxWidth, lineHeight, pad / 2);
      ctx.fill();
    }
    if (style.outline) ctx.strokeText(line, x, baseline, maxWidth);
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, baseline, maxWidth);
  });
  ctx.restore();
}
