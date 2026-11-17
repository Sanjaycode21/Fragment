import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine, Captions, Clapperboard, Film, Focus, HardDrive, Link2, Pause, Play, Plus,
  Scissors, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { clipCaptions, displayTime, formatSubtitles, frameSize, presets } from './captions';
import type { Aspect, Caption, CaptionStyle, ClipRange } from './captions';
import { drawCaptions } from './caption-canvas';
import type { MediaJob, MediaMessage } from './media-job';
import { YouTubePanel } from './YouTubePanel';
import type { Highlight } from './highlights';
import './style.css';

type Progress = { label: string; percent?: number };
type VideoInfo = { duration: number; width: number; height: number };
type SourceOptions = { requestedRange?: ClipRange; autoClip?: boolean; captionOnly?: boolean };
const initialStyle: CaptionStyle = { ...presets.Clean };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Seconds({ label, value, min, max, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label={label} title={label} type="number" min={min} max={max} step="any"
    value={draft ?? Number(value.toFixed(3))}
    onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      const seconds = event.target.valueAsNumber;
      if (draft !== null && Number.isFinite(seconds)) onCommit(Math.min(max, Math.max(min, seconds)));
      setDraft(null);
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
  />;
}

function preserveOutside(captions: Caption[], range: ClipRange) {
  return captions.flatMap(cue => {
    if (cue.end <= range.start || cue.start >= range.end) return [cue];
    const pieces: Caption[] = [];
    if (cue.start < range.start) pieces.push({ ...cue, end: range.start });
    if (cue.end > range.end) pieces.push({ ...cue, id: crypto.randomUUID(), start: range.end });
    return pieces;
  });
}

function App() {
  const [source, setSource] = useState<({ file: File; url: string } & SourceOptions) | null>(null);
  const { file, url } = source ?? {};
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [range, setRange] = useState<ClipRange>({ start: 0, end: 0 });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [aspect, setAspect] = useState<Aspect>('source');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [style, setStyle] = useState<CaptionStyle>(initialStyle);
  const [preset, setPreset] = useState<keyof typeof presets | null>('Clean');
  const [panel, setPanel] = useState<'captions' | 'style'>('captions');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const pickerOptions = useRef<SourceOptions>({});
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const duration = range.end - range.start;
  const active = Boolean(file && videoInfo && duration > 0);
  const visibleCues = useMemo(() => clipCaptions(captions, range), [captions, range]);
  const size = videoInfo ? frameSize(videoInfo.width, videoInfo.height, aspect) : { width: 1280, height: 720 };
  const outputName = (file?.name.replace(/\.[^.]+$/, '') || 'fragment') + '-clip';

  useEffect(() => {
    if (url) return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => () => worker.current?.terminate(), []);

  useEffect(() => {
    const player = video.current;
    if (!player || !playing) return;
    let frame: number;
    const tick = () => {
      const next = player.currentTime;
      if (next >= range.end || next < range.start) {
        player.pause();
        player.currentTime = next < range.start ? range.start : range.end;
        setTime(player.currentTime);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, range]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.width, size.height);
    drawCaptions(ctx, visibleCues, time - range.start, style);
  }, [visibleCues, range.start, size.height, size.width, style, time, url, videoInfo]);

  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  }

  function browseFile(options: typeof pickerOptions.current = {}) {
    pickerOptions.current = options;
    picker.current?.click();
  }

  function openFile(selected?: File, options: typeof pickerOptions.current = {}) {
    if (!selected) return;
    cancel();
    video.current?.pause();
    setYoutubeOpen(false);
    setSource({ file: selected, url: URL.createObjectURL(selected), ...options });
    setVideoInfo(null);
    setRange({ start: 0, end: 0 });
    setPlaying(false);
    setTime(0);
    setCaptions([]);
    setHighlights([]);
    setNotice('');
    setError('');
  }

  function seek(seconds: number) {
    if (!video.current) return;
    video.current.currentTime = seconds;
    setTime(seconds);
  }

  function updateRange(next: ClipRange) {
    video.current?.pause();
    setRange(next);
    if (time < next.start || time >= next.end) seek(next.start);
  }

  function useYouTubeRange(next: ClipRange) {
    if (!videoInfo) {
      browseFile({ requestedRange: next });
      return;
    }
    setYoutubeOpen(false);
    if (next.start >= videoInfo.duration || next.end > videoInfo.duration + 0.05) {
      setError('The YouTube range is outside this video. Import a matching local file.');
      return;
    }
    setError('');
    updateRange({ start: next.start, end: Math.min(next.end, videoInfo.duration) });
  }

  function findHighlights(auto = false) {
    if (!file || !videoInfo) {
      browseFile({ autoClip: auto });
      return;
    }
    setYoutubeOpen(false);
    run({ kind: 'highlights', file, range: { start: 0, end: videoInfo.duration }, auto });
  }

  function togglePlayback() {
    const player = video.current;
    if (!player || !active) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    if (player.currentTime < range.start || player.currentTime >= range.end) seek(range.start);
    void player.play().catch(() => setError('The browser could not play this video.'));
  }

  function run(job: MediaJob) {
    setError('');
    setNotice('');
    const jobLabels = { export: 'Preparing MP4', transcribe: 'Preparing transcription', highlights: 'Finding highlights' };
    setProgress({ label: jobLabels[job.kind] });
    const current = new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    current.onmessage = ({ data }: MessageEvent<MediaMessage>) => {
      if (worker.current !== current) return;
      if (data.kind === 'progress') {
        setProgress({ label: data.label, percent: data.percent });
        return;
      }
      cancel();
      if (data.kind === 'error') {
        if (job.kind === 'transcribe' && data.retryOnCPU && !job.cpu) {
          run({ ...job, cpu: true });
          setProgress({ label: 'Retrying transcription on CPU' });
        } else setError(data.message);
      } else if (data.kind === 'highlights') {
        setHighlights(data.highlights);
        const best = data.highlights[0];
        if (best) {
          updateRange({ start: best.start, end: best.end });
          seek(best.start);
          if (job.kind === 'highlights' && job.auto) {
            run({ kind: 'transcribe', file: job.file, range: { start: best.start, end: best.end } });
          } else setNotice('Top audio suggestion selected. Play or export the clip.');
        } else {
          setNotice('No standout audio peaks found.');
        }
      } else if (data.kind === 'transcript') {
        if (data.captions.length) {
          setCaptions(existing => [...preserveOutside(existing, job.range), ...data.captions]);
          setPanel('captions');
          setNotice(data.captions.length + (data.captions.length === 1 ? ' caption generated.' : ' captions generated.'));
        } else {
          setNotice('Whisper found no speech in this range. You can add captions manually.');
        }
      } else {
        download(new Blob([data.buffer], { type: 'video/mp4' }), outputName + '.mp4');
        setNotice('MP4 exported.');
      }
    };
    current.onerror = event => {
      if (worker.current !== current) return;
      event.preventDefault();
      cancel();
      setError('The media worker stopped. Try a shorter clip or use a current version of Chrome or Edge.');
    };
    current.postMessage(job);
  }

  function addCaption() {
    const start = Math.max(range.start, Math.min(time, range.end - Math.min(duration, 2)));
    setCaptions(existing => [...existing, {
      start, end: Math.min(range.end, start + 2), text: '', id: crypto.randomUUID(),
    }]);
  }

  function editCaption(id: string, change: Partial<Caption>) {
    setCaptions(existing => existing.map(cue => cue.id === id ? { ...cue, ...change } : cue));
  }

  function changeStyle(change: Partial<CaptionStyle>) {
    setStyle(current => ({ ...current, ...change }));
    setPreset(null);
  }

  function exportSubtitles(format: 'srt' | 'vtt') {
    const text = formatSubtitles(captions, range, format);
    download(new Blob([text], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8' }), outputName + '.' + format);
  }

  return <>
    <header className="topbar">
      <div className="identity"><span className="logo"><Clapperboard size={18} /></span><strong>Fragment</strong>
        <span className="divider" /><span className="workspace-label">Clip editor</span></div>
      <div className="top-actions">
        <span className="local"><HardDrive size={14} /> Local workspace</span>
        <button type="button" aria-expanded={youtubeOpen} onClick={() => {
          video.current?.pause();
          setYoutubeOpen(open => !open);
        }}><Sparkles size={15} /> Auto clip</button>
        <button type="button" aria-label="Import video file" onClick={() => browseFile({ autoClip: true })}><Upload size={15} /> <span>Import video</span></button>
        <button type="button" className="primary" disabled={!active || !!progress} onClick={() => {
          if (file) run({ kind: 'export', file, range, captions, style, ...size });
        }}><ArrowDownToLine size={16} /> Export MP4</button>
        <input ref={picker} hidden type="file" accept="video/*,.mkv,.mov,.mp4,.webm" aria-label="Import video"
          onChange={event => {
            openFile(event.currentTarget.files?.[0], pickerOptions.current);
            pickerOptions.current = {};
            event.currentTarget.value = '';
          }} />
      </div>
    </header>

    <main className="workspace">
      {youtubeOpen && <YouTubePanel onClose={() => setYoutubeOpen(false)} onUseRange={useYouTubeRange}
        onAnalyzeVideo={() => findHighlights(true)} onAutoClip={downloaded => openFile(downloaded, { captionOnly: true })}
        hasLocalVideo={active} busy={Boolean(progress)} />}
      <div className="edit-column">
        <section className="preview" aria-label="Video preview">
          <div className="section-bar"><span><Film size={16} /> Preview</span>
            <select aria-label="Aspect ratio" value={aspect} disabled={!active || !!progress}
              onChange={event => setAspect(event.target.value as Aspect)}>
              <option value="source">Original</option><option>16:9</option><option>9:16</option><option>1:1</option>
            </select>
          </div>
          <div className={'stage' + (dragging ? ' dragging' : '')}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={event => { event.preventDefault(); setDragging(false); openFile(event.dataTransfer.files[0], { autoClip: true }); }}>
            {url ? <div className="video-frame" style={{ aspectRatio: size.width + '/' + size.height, '--frame-ratio': size.width / size.height } as React.CSSProperties}>
              <video key={url} ref={video} src={url} playsInline preload="metadata"
                onLoadedMetadata={event => {
                  const { duration, videoWidth: width, videoHeight: height } = event.currentTarget;
                  if (!Number.isFinite(duration) || !duration || !width || !height) {
                    setError('This file does not contain a supported video with a finite duration.');
                    return;
                  }
                  setVideoInfo({ duration, width, height });
                  if (source?.autoClip) run({ kind: 'highlights', file: source.file, range: { start: 0, end: duration }, auto: true });
                  if (source?.captionOnly) run({ kind: 'transcribe', file: source.file, range: { start: 0, end: duration } });
                  const requestedRange = source?.requestedRange;
                  if (requestedRange && requestedRange.start < duration && requestedRange.end <= duration + 0.05) {
                    setRange({ start: requestedRange.start, end: Math.min(requestedRange.end, duration) });
                    seek(requestedRange.start);
                  } else {
                    setRange({ start: 0, end: duration });
                    if (requestedRange) setError('The YouTube range is outside this file. Import a matching local video or set a new range.');
                  }
                }}
                onError={() => {
                  setVideoInfo(null);
                  setError('This video could not open. Try a browser-compatible MP4 or WebM.');
                }}
                onTimeUpdate={event => { if (event.currentTarget.paused) setTime(event.currentTarget.currentTime); }}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
              />
              <canvas ref={canvas} width={size.width} height={size.height} aria-hidden="true" />
            </div> : <div className="empty-video">
              <span className="empty-icon"><Film size={28} strokeWidth={1.4} /></span>
              <h1>Open a video</h1>
              <p>Start with a video link or drop a local file to find and caption a clip.</p>
              <div className="source-actions">
                <button onClick={() => browseFile({ autoClip: true })}><Plus size={16} /> Choose video</button>
                <button onClick={() => setYoutubeOpen(true)}><Link2 size={16} /> Paste video link</button>
              </div>
            </div>}
          </div>
          <div className="player">
            <button type="button" className="icon" aria-label={playing ? 'Pause clip' : 'Play clip'} disabled={!active} onClick={togglePlayback}>
              {playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <span className="time">{displayTime(time)}</span>
            <input aria-label="Seek source video" type="range" min={0} max={videoInfo?.duration ?? 1}
              step="any" value={time} disabled={!active} onChange={event => { video.current?.pause(); seek(Number(event.target.value)); }} />
            <span className="time muted">{displayTime(videoInfo?.duration ?? 0)}</span>
          </div>
        </section>

        <section className="trim" aria-label="Clip range">
          <div className="section-bar"><span><Scissors size={16} /> Clip range</span><span className="muted time">{displayTime(duration)} selected</span></div>
          <div className="trim-content">
            <button className="find-highlights" type="button" disabled={!active || !!progress} onClick={() => findHighlights()}>
              <Sparkles size={15} /> Find highlights
            </button>
            {highlights.length > 0 && <ul className="highlight-list" aria-label="Suggested local clips">
              {highlights.map(item => <li key={item.start}>
                <span>{item.reason} <span className="time muted">{displayTime(item.start)} – {displayTime(item.end)}</span></span>
                <button type="button" disabled={!!progress} aria-pressed={range.start === item.start && range.end === item.end}
                  onClick={() => { updateRange({ start: item.start, end: item.end }); seek(item.start); }}>Use clip</button>
              </li>)}
            </ul>}
            <div className="track" aria-hidden="true" style={{
              '--in': (videoInfo ? range.start / videoInfo.duration * 100 : 0) + '%',
              '--out': (videoInfo ? 100 - range.end / videoInfo.duration * 100 : 100) + '%',
            } as React.CSSProperties}><span /></div>
            <fieldset disabled={!active || !!progress} className="range-fields">
              <label>In (s) <Seconds label="Clip in (seconds)" value={range.start} min={0} max={Math.max(0, range.end - Math.min(0.01, duration))}
                onCommit={start => updateRange({ ...range, start })} /></label>
              <button type="button" title="Set in point to playhead" disabled={time >= range.end} onClick={() => updateRange({ ...range, start: time })}>Set in</button>
              <label>Out (s) <Seconds label="Clip out (seconds)" value={range.end} min={range.start + Math.min(0.01, duration)} max={videoInfo?.duration ?? 0}
                onCommit={end => updateRange({ ...range, end })} /></label>
              <button type="button" title="Set out point to playhead" disabled={time <= range.start} onClick={() => updateRange({ ...range, end: time })}>Set out</button>
            </fieldset>
          </div>
        </section>
      </div>

      <aside className="inspector" aria-label="Caption editor">
        <div className="section-bar"><span><Captions size={18} /> Captions</span>{file && <span className="muted count">{visibleCues.length}</span>}</div>
        <div className="tabs" aria-label="Caption tools">
          <button type="button" aria-pressed={panel === 'captions'} onClick={() => setPanel('captions')}>Transcript</button>
          <button type="button" aria-pressed={panel === 'style'} onClick={() => setPanel('style')}>Style</button>
        </div>
        <div className="inspector-body">
          <div className="generate">
            <button type="button" className="primary" disabled={!active || !!progress} onClick={() => {
              if (file) run({ kind: 'transcribe', file, range });
            }}><Sparkles size={16} /> {visibleCues.length ? 'Regenerate clip captions' : 'Generate captions'}</button>
            <p>English captions. Whisper downloads on first use. Your audio stays on this device.</p>
          </div>
          {progress && <div className="task" role="status">
            <div>{progress.label}<button className="icon" type="button" aria-label="Cancel processing" onClick={cancel}><X size={15} /></button></div>
            <progress aria-label={progress.label} max={100} value={progress.percent} />
          </div>}
          {error && <p className="message error" role="alert">{error}</p>}
          {notice && <p className="message" role="status">{notice}</p>}
          {panel === 'captions' ? <>
            {visibleCues.length === 0 && <div className="empty-captions">
              <span><Captions size={21} /></span>
              <h2>No captions yet</h2>
              <p>{active ? 'Generate captions for the selected range or add one manually.' : 'Import a video to start captioning.'}</p>
            </div>}
            {visibleCues.length > 0 && <div className="cue-list">
              <p className="hint">Cue times are relative to the clip.</p>
              {visibleCues.map((cue, index) => {
                return <fieldset className="cue" disabled={!!progress} key={cue.id}>
                  <div className="cue-times">
                    <button type="button" className="icon" aria-label={'Seek to caption ' + (index + 1)} onClick={() => seek(cue.start + range.start)}><Focus size={15} /></button>
                    <Seconds label={'Caption ' + (index + 1) + ' start (seconds)'} value={cue.start} min={0} max={cue.end - Math.min(0.001, cue.end - cue.start)}
                      onCommit={start => editCaption(cue.id, { start: start + range.start })} />
                    <span aria-hidden="true">–</span>
                    <Seconds label={'Caption ' + (index + 1) + ' end (seconds)'} value={cue.end} min={cue.start + Math.min(0.001, cue.end - cue.start)} max={duration}
                      onCommit={end => editCaption(cue.id, { end: end + range.start })} />
                    <button type="button" className="icon delete" aria-label={'Delete caption ' + (index + 1)}
                      onClick={() => setCaptions(existing => existing.filter(item => item.id !== cue.id))}><Trash2 size={15} /></button>
                  </div>
                  <textarea aria-label={'Caption ' + (index + 1) + ' text'} rows={2} value={cue.text} placeholder="Type caption…"
                    onChange={event => editCaption(cue.id, { text: event.target.value })} />
                </fieldset>;
              })}
            </div>}
            <button type="button" className="add-caption" disabled={!active || !!progress} onClick={addCaption}><Plus size={15} /> Add caption</button>
          </> : <fieldset className="styling" disabled={!active || !!progress}>
            <legend>Caption preset</legend>
            <div className="presets">{(Object.keys(presets) as (keyof typeof presets)[]).map(name =>
              <button type="button" key={name} aria-pressed={preset === name} onClick={() => { setStyle({ ...presets[name] }); setPreset(name); }}>{name}</button>)}</div>
            <label>Font size <output>{style.size}%</output>
              <input type="range" min={2} max={12} step={0.5} value={style.size} onChange={event => changeStyle({ size: Number(event.target.value) })} /></label>
            <label>Horizontal position <output>{style.horizontal}%</output>
              <input type="range" min={5} max={95} step={1} value={style.horizontal} onChange={event => changeStyle({ horizontal: Number(event.target.value) })} /></label>
            <label>Vertical position <output>{style.vertical}%</output>
              <input type="range" min={5} max={95} step={1} value={style.vertical} onChange={event => changeStyle({ vertical: Number(event.target.value) })} /></label>
            <label className="style-row">Text color <input type="color" value={style.color} onChange={event => changeStyle({ color: event.target.value })} /></label>
            <label className="style-row">Outline <input type="checkbox" checked={style.outline} onChange={event => changeStyle({ outline: event.target.checked })} /></label>
            <label className="style-row">Background <input type="checkbox" checked={style.background} onChange={event => changeStyle({ background: event.target.checked })} /></label>
          </fieldset>}
        </div>
        <div className="subtitle-downloads">
          <button type="button" disabled={!visibleCues.some(cue => cue.text.trim())} onClick={() => exportSubtitles('srt')}><ArrowDownToLine size={15} /> SRT</button>
          <button type="button" disabled={!visibleCues.some(cue => cue.text.trim())} onClick={() => exportSubtitles('vtt')}><ArrowDownToLine size={15} /> VTT</button>
        </div>
      </aside>
    </main>
    {file && <footer className="file-details">
      <Film size={14} /><span title={file.name}>{file.name}</span>
      {videoInfo && <span>{videoInfo.width} × {videoInfo.height}</span>}
      <span>{(file.size / 1_000_000).toFixed(1)} MB</span>
    </footer>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
