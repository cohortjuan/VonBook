import dns from 'dns/promises';
import net from 'net';

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 200_000; // plenty for a page's <head>, keeps this from ever downloading a huge response
const USER_AGENT = 'VonBookBot/1.0 (link preview; contact: dajuan.hume@gmail.com)';

// basic ssrf guard: refuses to fetch a hostname that resolves to a
// private/loopback/link-local address, so a post's link can't be used to
// probe this backend's own internal network. not bulletproof -- a
// redirect could still repoint at an internal address after this check
// runs (fetch below follows redirects without re-checking each hop) --
// but this app's whole user base is friends and family, not the public
// internet, so a basic check is proportionate here, not a full fix.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

// meta content is raw HTML source, where a literal & has to be written as
// &amp; -- without decoding, a scraped image url's query string (usually
// full of &param=value pairs) comes out with literal "amp;" text baked
// into it and breaks.
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// finds a <meta property="..." content="..."> tag's content regardless of
// attribute order (property before content, or the reverse -- real pages
// do both), trying each property name in turn.
function extractMeta(html, ...properties) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const propMatch = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!propMatch || !properties.includes(propMatch[1].toLowerCase())) continue;
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (contentMatch && contentMatch[1]) return decodeHtmlEntities(contentMatch[1]);
  }
  return null;
}

// best-effort open graph scrape for a post's attached link. never throws
// -- a broken/unreachable/blocked link just means no preview, and the
// post still goes through with the vonbook logo as its fallback image
// (see PostCard.jsx), not a failed post.
export async function fetchLinkPreview(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIp(address)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html = '';
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok || !res.body) return null;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (html.length < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    } finally {
      clearTimeout(timeout);
    }

    const rawTitle = extractMeta(html, 'og:title', 'twitter:title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;
    const rawImage = extractMeta(html, 'og:image', 'twitter:image');

    return {
      title: title ? title.trim().slice(0, 200) : null,
      imageUrl: rawImage ? new URL(rawImage, url).href : null,
    };
  } catch {
    return null;
  }
}
