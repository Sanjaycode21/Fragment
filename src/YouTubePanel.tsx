import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Link2, Play, Sparkles, X } from 'lucide-react';
import { displayTime } from './captions';
import type { ClipRange } from './captions';
import { transcriptHighlights } from './highlights';
import type { Highlight } from './highlights';
import { loadYouTubeAPI, parseYouTubeLink } from './youtube';
import type { YouTubeLink, YouTubePlayer } from './youtube';
import { parseVideoLink } from './video-link';
import { generateLinkedClip } from './linked-clip';

export function YouTubePanel({ onClose, onUseRange, onAnalyzeVideo, onAutoClip, hasLocalVideo, busy }: {
  onClose: () => void;
  onUseRange: (range: ClipRange) => void;
  onAnalyzeVideo: () => void;
  onAutoClip: (file: File) => void;
  hasLocalVideo: boolean;
  busy: boolean;
}) {
  const [link, setLink] = useState('');
  const [selected, setSelected] = useState<YouTubeLink | null>(null);
  const [linkError, setLinkError] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [ready, setReady] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [rangeError, setRangeError] = useState('');
  const [fetching, setFetching] = useState('');
  const request = useRef<AbortController | null>(null);
  const importVersion = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const mountId = useId();

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    const container = host.current;
    if (!container || !selected) return;
    let disposed = false;
    const placeholder = document.createElement('div');
    placeholder.id = mountId;
    container.append(placeholder);
    const timeout = window.setTimeout(() => {
      setPlayerError('YouTube did not start. Try reloading the preview or opening the video on YouTube.');
    }, 18_000);
    loadYouTubeAPI().then(api => {
      if (disposed) return;
      player.current = new api.Player(mountId, {
        videoId: selected.id,
        width: '100%',
        height: '100%',
        playerVars: { origin: window.location.origin, start: selected.start, playsinline: 1 },
        events: {
          onReady() {
            if (disposed) return;
            window.clearTimeout(timeout);
            setPlayerError('');
            setReady(true);
          },
          onError({ data }) {
            if (disposed) return;
            window.clearTimeout(timeout);
            setReady(false);
            setPlayerError(data === 101 || data === 150
              ? 'The owner disabled embedded playback. Open the video on YouTube.'
              : 'This video could not play here. Check the link or open it on YouTube.');
          },
          onAutoplayBlocked() {
            if (!disposed) setRangeError('Press Play inside the YouTube player to start the clip.');
          },
        },
      });
    }).catch(() => {
      if (disposed) return;
      window.clearTimeout(timeout);
      setPlayerError('The YouTube player could not load. Check your connection or open the video on YouTube.');
    });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      player.current?.destroy();
      player.current = null;
      container.replaceChildren();
    };
  }, [selected, mountId]);

  function playClip({ start, end }: Highlight) {
    if (!selected || !player.current) return;
    const duration = player.current.getDuration();
    if (duration > 0 && start >= duration) {
      setRangeError('This suggestion is outside the video. Import a transcript that matches the link.');
      return;
    }
    setRangeError('');
    player.current.loadVideoById({ videoId: selected.id, startSeconds: start, endSeconds: duration > 0 ? Math.min(end, duration) : end });
  }

  async function importTranscript(file?: File) {
    if (!file) return;
    const version = ++importVersion.current;
    setRangeError('');
    setHighlights([]);
    try {
      const { cueCount, highlights } = transcriptHighlights(await file.text());
      if (version !== importVersion.current) return;
      setHighlights(highlights);
      if (!highlights.length) setRangeError(cueCount
        ? 'No strong dialogue cues found. Try analyzing the matching local video.'
        : 'No valid cues found. Choose a timestamped SRT or VTT transcript.');
    } catch {
      if (version === importVersion.current) setRangeError('The transcript could not be opened.');
    }
  }

  function showPreview() {
    const parsed = parseYouTubeLink(link);
    if (!parsed) {
      setLinkError('Preview is available for YouTube video and Shorts links.');
      return;
    }
    setLinkError('');
    setPlayerError('');
    setReady(false);
    importVersion.current++;
    setHighlights([]);
    setRangeError('');
    setSelected(parsed);
  }

  async function generate() {
    const video = parseVideoLink(link);
    if (!video) {
      setLinkError('Enter a YouTube, Instagram, or TikTok video link.');
      return;
    }
    setLinkError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const clip = await generateLinkedClip(video, controller.signal, setFetching);
      if (!controller.signal.aborted) onAutoClip(clip);
    } catch (error) {
      if (!controller.signal.aborted) setLinkError(error instanceof Error ? error.message : 'The source could not be opened.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setFetching('');
    }
  }

  return <section className="youtube-panel" aria-label="Automatic clip generator">
    <div className="section-bar">
      <span><Sparkles size={16} /> Auto clip</span>
      <button className="icon" type="button" aria-label="Close auto clip" onClick={onClose}><X size={17} /></button>
    </div>
    <div className="youtube-content">
      <form className="youtube-form" onSubmit={event => {
        event.preventDefault();
        if (!fetching && !busy) void generate();
      }}>
        <label htmlFor={mountId + '-link'}>Video link</label>
        <div>
          <input id={mountId + '-link'} ref={input} type="text" inputMode="url" autoComplete="off"
            placeholder="Paste a YouTube, Instagram or TikTok link" value={link} disabled={Boolean(fetching)}
            aria-invalid={Boolean(linkError)}
            onChange={event => { setLink(event.target.value); setLinkError(''); }} />
          <button type="submit" className="primary" disabled={Boolean(fetching) || busy}><Sparkles size={15} /> Generate clip</button>
        </div>
      </form>
      {linkError && <p className="message error" role="alert">{linkError}</p>}
      {fetching && <p className="message" role="status">{fetching}</p>}
      <div className="youtube-tools">
        <button type="button" disabled={Boolean(fetching) || busy} onClick={onAnalyzeVideo}>
          {hasLocalVideo ? 'Generate from loaded video' : 'Choose local video'}
        </button>
        <button type="button" disabled={Boolean(fetching) || !parseYouTubeLink(link)} onClick={showPreview}>
          <Link2 size={15} /> Preview on YouTube
        </button>
      </div>
      {selected && <>
        <div className="youtube-player" ref={host} />
        {playerError ? <p className="message error" role="alert">{playerError}</p>
          : !ready && <p className="muted" role="status">Loading YouTube player…</p>}
        <div className="youtube-tools">
          <label>Import transcript <input type="file" accept=".srt,.vtt"
            onChange={event => { void importTranscript(event.target.files?.[0]); event.target.value = ''; }} /></label>
          <a href={'https://www.youtube.com/watch?v=' + selected.id} target="_blank" rel="noreferrer">
            Open on YouTube <ExternalLink size={13} />
          </a>
        </div>
        {rangeError && <p className="message error" role="status">{rangeError}</p>}
        {highlights.length > 0 && <ul className="highlight-list" aria-label="Suggested YouTube clips">
          {highlights.map(item => <li key={item.start}>
            <span>{item.reason} <span className="time muted">{displayTime(item.start)} – {displayTime(item.end)}</span></span>
            <button type="button" disabled={!ready} onClick={() => playClip(item)}><Play size={15} /> Play clip</button>
            <button type="button" disabled={busy} onClick={() => {
              player.current?.pauseVideo();
              onUseRange({ start: item.start, end: item.end });
            }}>{hasLocalVideo ? 'Apply to local video' : 'Import video for this clip'}</button>
          </li>)}
        </ul>}
      </>}
    </div>
  </section>;
}
