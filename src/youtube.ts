const videoId = /^[\w-]{11}$/;
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function parseYouTubeLink(value: string) {
  const input = value.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : 'https://' + input);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const [, first, second, ...rest] = url.pathname.replace(/\/$/, '').split('/');
  const id = url.hostname === 'youtu.be' && !second ? first
    : youtubeHosts.has(url.hostname) && !rest.length
      ? first === 'watch' && !second ? url.searchParams.get('v')
        : ['shorts', 'embed', 'live'].includes(first) ? second : null
      : null;
  if (!id || !videoId.test(id)) return null;

  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '';
  const parts = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  const start = /^\d+$/.test(raw) ? Number(raw)
    : parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0) : 0;
  return { id, start: Number.isSafeInteger(start) ? start : 0 };
}

export type YouTubeLink = NonNullable<ReturnType<typeof parseYouTubeLink>>;

export interface YouTubePlayer {
  destroy(): void;
  getDuration(): number;
  loadVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  pauseVideo(): void;
}

interface YouTubeAPI {
  Player: new (id: string, config: {
    videoId: string;
    width: string;
    height: string;
    playerVars: { origin: string; start: number; playsinline: number };
    events: {
      onReady(event: { target: YouTubePlayer }): void;
      onError(event: { data: number }): void;
      onAutoplayBlocked(): void;
    };
  }) => YouTubePlayer;
}

let loading: Promise<YouTubeAPI> | undefined;

export function loadYouTubeAPI(): Promise<YouTubeAPI> {
  const browser = window as Window & { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void };
  if (browser.YT?.Player) return Promise.resolve(browser.YT);
  if (loading) return loading;

  loading = new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    const previous = browser.onYouTubeIframeAPIReady;
    function cleanup() {
      window.clearTimeout(timeout);
      browser.onYouTubeIframeAPIReady = previous;
    }
    function fail() {
      cleanup();
      script.remove();
      reject(new Error('The YouTube player could not load.'));
    }
    const timeout = window.setTimeout(fail, 12_000);
    script.onerror = fail;
    browser.onYouTubeIframeAPIReady = () => {
      if (!browser.YT?.Player) return fail();
      cleanup();
      resolve(browser.YT);
      previous?.();
    };
    document.head.append(script);
  }).catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}
