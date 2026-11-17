import { parseYouTubeLink } from './youtube.ts';

export function parseVideoLink(input: string) {
  const youtube = parseYouTubeLink(input);
  if (youtube) return { url: 'https://www.youtube.com/watch?v=' + youtube.id, name: 'YouTube-' + youtube.id };

  const value = input.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : 'https://' + value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (['www.instagram.com', 'instagram.com'].includes(url.hostname)) {
      const match = /^\/(reel|p|tv)\/([\w-]{5,32})\/?$/.exec(url.pathname);
      if (match) return { url: 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/', name: 'Instagram-' + match[2] };
    }
    if (['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) {
      const match = /^\/@([\w.]{2,32})\/video\/(\d{10,24})\/?$/.exec(url.pathname);
      if (match) return { url: 'https://www.tiktok.com/@' + match[1] + '/video/' + match[2], name: 'TikTok-' + match[2] };
    }
    if (['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname)) {
      const match = /^\/([\w-]{4,32})\/?$/.exec(url.pathname);
      if (match) return { url: 'https://' + url.hostname + '/' + match[1] + '/', name: 'TikTok-' + match[1] };
    }
  } catch {
    return null;
  }
  return null;
}
