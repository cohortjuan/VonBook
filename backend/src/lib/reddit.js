// reddit now redirects anonymous requests to its old public .json
// endpoints to a login wall (confirmed directly -- www.reddit.com/r/x/top.json
// 403s, old.reddit.com/r/x/top.json 302s to /login), so this goes through
// a real (free) reddit "script" app instead: reddit.com/prefs/apps ->
// create app -> script. REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET below are
// that app's credentials, used for the client_credentials grant -- read-only,
// app-level access, no reddit user ever has to log in.
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const USER_AGENT = 'VonBookBot/1.0 (birthday present app; contact: dajuan.hume@gmail.com)';

let cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`reddit token request failed: ${res.status}`);

  const data = await res.json();
  // shave a minute off so a token never expires mid-request
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// today's top posts from one subreddit, filtered down to plain sfw image
// posts -- exactly what VonBot has a shot at reposting (see lib/vonbot.js).
// self-text posts, videos, galleries, and stickied mod posts are all
// skipped rather than handled, to keep the repost pipeline simple.
export async function fetchTopImagePosts(subreddit, limit = 10) {
  const token = await getAccessToken();
  const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/top?limit=${limit}&t=day`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`reddit fetch failed for r/${subreddit}: ${res.status}`);

  const data = await res.json();
  return data.data.children
    .map((c) => c.data)
    .filter((p) => !p.over_18 && !p.stickied && p.post_hint === 'image' && p.url)
    .map((p) => ({
      id: p.id,
      title: p.title,
      imageUrl: p.url,
      permalink: `https://reddit.com${p.permalink}`,
      subreddit,
    }));
}
