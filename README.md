# VonBook -- the gamers lounge

Facebook profile + Messenger chat/calls + an Instagram-style feed + a gaming hub, built as one app. Made as a birthday present, with a special founder account for the birthday boy.

## Stack

Same pattern as the other apps in this course folder: **Express + PostgreSQL** backend (`backend/`), **React + Vite** frontend (`frontend/`), plain SQL schema (`database/schema.sql`), Postgres in Docker for local dev. Chat/calls/presence run over **Socket.IO** on the same backend process. The frontend is a PWA (installable to a phone home screen) and mobile-first throughout.

## Local setup

1. **Database** (needs Docker Desktop running):
   ```bash
   docker compose up -d
   ```
   This starts Postgres on `localhost:5434` (5432/5433 were already taken by this folder's other projects) and creates the `vonbook` database. The schema is applied automatically, both by the container's init script and again by the backend on every boot (`ensureSchema()` in `backend/src/db/pool.js` — safe to run repeatedly, everything's `IF NOT EXISTS`).

2. **Backend**:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Copy `.env.example` to `.env` first if it's not already there. **Set `FOUNDER_CLAIM_CODE`** to something only your son will get (a note in his birthday card, etc.) before he signs up — whoever signs up with that code first becomes the permanent founder account. It can only ever be claimed once, enforced at the database level.

3. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`.

Both `npm run dev` commands watch for changes and restart/hot-reload automatically.

## Deploying (Vercel + Render)

Same two services as this folder's Whispers App project. REST calls are proxied through Vercel's own domain to the Render backend (`frontend/vercel.json` rewrites `/api/*` and `/uploads/*`), so from the browser's point of view every REST call is same-origin — that's what actually keeps the login cookie working, since modern browsers block a cross-site cookie as "third-party" regardless of any `SameSite` setting. The one connection that's still genuinely cross-site is Socket.IO (chat/calls/presence) — a WebSocket handshake can't be proxied through a Vercel rewrite, so it connects to the Render backend directly and authenticates with a short-lived ticket instead of the cookie (see `backend/src/lib/socketTickets.js`).

1. **Push to GitHub** (once, if not done already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Backend, on Render**: New → Blueprint → pick this repo. `render.yaml` at the repo root sets up the web service (rooted at `backend/`) and a free Postgres database together. It'll prompt you for two values it can't guess:
   - `FOUNDER_CLAIM_CODE` — same as local
   - `CORS_ORIGIN` — leave a placeholder for now (e.g. `http://localhost:5173`), you'll come back and fix this after step 3
   
   Once it's deployed, copy the backend's `https://vonbook-backend-xxxx.onrender.com` URL — you need it next. **Auto-deploy on this Render account doesn't reliably fire on push** — after any backend change, go to the service → Manual Deploy → Deploy latest commit.

3. **Frontend, on Vercel**: New Project → import the same repo → set **Root Directory to `frontend`** (important, this is not a single-app repo) → add one environment variable:
   - `VITE_SOCKET_URL` = `https://<your-render-url>` (the direct socket connection mentioned above)
   
   `VITE_API_URL` doesn't need to be set — the frontend defaults to the relative `/api`, which `vercel.json` already proxies to Render. If `frontend/vercel.json`'s rewrite target isn't this exact project's Render URL, update it there too. Deploy, then copy the resulting `https://vonbook-xxxx.vercel.app` URL.

4. **Back on Render**: edit the `CORS_ORIGIN` env var to your real Vercel URL from step 3, save (this redeploys automatically — or use Manual Deploy if it doesn't). Without this the backend rejects the socket connection from the deployed frontend.

5. **Persistent uploads**: on Render's free tier, a plain web service's filesystem is ephemeral — anything written to local disk (avatars, post/message photos and videos) vanishes on every redeploy. The fix actually in use: set `CLOUDINARY_URL` (see `backend/.env.example`) to move uploads to Cloudinary's free tier instead, which survives redeploys. Leaving it unset falls back to local disk, which is fine for local dev but not for a real production deploy. (A paid Render plan's persistent Disk is a different, also-valid fix — see the comment in `render.yaml` — but Cloudinary is the one this project is actually configured for, and it's free.) Every Cloudinary-hosted image/video is also served through Cloudinary's automatic `q_auto,f_auto` optimization (smallest quality that still looks right, best format per browser) — see `getFileUrl()` in `frontend/src/api/client.js`. It's a URL transformation, not an upload-time setting, so it applies to everything already uploaded too, no extra config needed.

6. **VonBot — optional**: an automated account that reposts one trending gaming/anime/movie/superhero image a day (pulled from a few public RSS feeds — see `backend/src/lib/rssFeeds.js`, no API key needed) so the feed stays active on its own. Set a `VONBOT_KEY` secret on Render, and add that same value as a repo secret in GitHub (Settings → Secrets and variables → Actions) so `.github/workflows/vonbot.yml` can call it on a schedule (see `backend/.env.example`). Leaving `VONBOT_KEY` unset just means the tick endpoint refuses every request — nothing else depends on it.

**One honest caveat that's still true regardless of the above**: Render's **free** Postgres database expires after 90 days — Render emails a warning; upgrade it or take a `pg_dump` backup before then if you want to keep it going. (Unrelated to uploads above — that's about the database, not file storage.)

## The founder account

Whoever signs up with the `FOUNDER_CLAIM_CODE` gets:
- A 👑 crown badge on their avatar everywhere (posts, comments, friends list, messages, notifications)
- Their display name in a gradient with a ✨
- A custom title under their name on their profile (defaults to "Founder & Birthday Star")
- An automatic site-wide "🎉 Happy Birthday!" banner + confetti, shown to *every* logged-in user, on the day that matches their `birthday` field (checked by month/day, so it recurs every year)
- Confetti on their own profile page on that day too

Give him the code, have him sign up with his real birthday set, and the rest is automatic. The banner is driven entirely by the `birthday` field on his account (month/day only, compared against each viewer's own local "today") — there's no code-level bug behind it, but it's easy to fat-finger the wrong day in the date picker at signup, so if the banner ever shows on the wrong day, check Settings → Edit Profile → Birthday first before assuming anything's broken.

## The intro

`frontend/public/intro-video.mp4` plays once, full-screen, the first time a signed-out visitor hits the site — in the last 5 seconds the alien logo, "VonBook", and "the gamers lounge" fade in over it, then it "powers off" like an old CRT and reveals the real landing page underneath (see `frontend/src/components/IntroSplash.jsx`). There's a mute toggle and a skip button.

## Easter eggs

- **Konami code** (↑ ↑ ↓ ↓ ← → ← → B A) anywhere in the app → confetti + a toast. On mobile, where there's no keyboard to press arrow keys on, the same 10-step sequence works as touch gestures instead: swipe ↑ ↑ ↓ ↓ ← → ← → then tap twice (see `frontend/src/hooks/useKonamiCode.js`)
- **Tap the alien logo 3 times** → drops you into a hidden, actually-playable Space Invaders game (also just the site's 404 page — any bad URL lands there too)
- **Tap the logo 5 times** (keep going past 3) → a few seconds of rainbow "party mode" on the header, on top of the game launch
- **Double-tap a photo** on a post → likes it with a heart burst, Instagram-style
- Open devtools → there's a message in the console

Don't spoil these for him.

## Features

- **Profiles**: bio, avatar, cover photo, birthday, a "🎮 currently playing" status shown on the profile and in the friends list
- **Gamer tags**: PSN, Xbox, and PC handles as linked-account badges, same mechanism as the social platforms below
- **Achievement posts**: tag a post with a game (🏆 badge) and attach a screenshot, same feed as everything else
- **Friends**: search by name/username, or import from phone contacts via the browser's native Contact Picker (Chrome on Android; falls back to search everywhere else since that API isn't available on desktop/iOS browsers) — nothing from a contact list is ever stored, it's a one-shot match against existing accounts (see `backend/src/routes/contacts.js`)
- **Feed**: Instagram-style posts with photos/videos, captions, likes, comments — photos are converted to JPEG client-side before upload (fixes iPhone HEIC photos not rendering in non-Safari browsers, and sideways photos from EXIF orientation, see `frontend/src/lib/imageProcessing.js`). Picking a photo/video anywhere in the app (a post, a message) shows a real thumbnail preview before it's sent, not just a filename. A post with multiple photos/videos is a native swipeable carousel with a "1/3"-style counter and a tap-to-jump thumbnail filmstrip underneath (see `frontend/src/components/PostCard.jsx`). Every relative timestamp ("2h", "3d") is also a hover tooltip with the full date and time (see `frontend/src/lib/timeAgo.js`)
- **Comment replies**: single-level threading — replying to a reply just collapses onto the original top-level comment instead of nesting further, same as most apps that do this (see `parent_id` in `database/schema.sql` and the comment routes in `backend/src/routes/posts.js`)
- **Link posts**: a post can carry a link instead of (or alongside) photos/videos/caption. The backend does a one-time, best-effort Open Graph scrape at post time (title + `og:image`, see `backend/src/lib/linkPreview.js`) with basic SSRF guards (blocks private/loopback/link-local addresses; not bulletproof against a redirect repointing mid-fetch, but this app's user base is friends and family, not the public internet). No image found (or the fetch fails/times out) just falls back to the VonBook logo — the post never fails because of a bad link
- **Reporting**: anyone (except the post's own author) can report a post; the first report immediately hides it from everyone, including its author, and notifies every dev account (see `is_dev` on users). A dev can then release it back to visible or delete it outright — see `hidden_at` / `post_reports` in `database/schema.sql` and the moderation routes in `backend/src/routes/posts.js`
- **Public posts**: a post is friends-only by default; a toggle on the composer (and on any of your own existing posts) opts it into everyone's feed instead — with a one-time warning dialog ("don't show this again" persists in `localStorage`) so going public is never an accident. The feed is friends' posts + your own + whatever anyone's made public (see `is_public` in `database/schema.sql` and `backend/src/routes/posts.js`). Settings also has a bulk "make all/none of my posts public" action using the same warning
- **Settings**: also where notifications actually get turned on now (a visible status + "Enable notifications" button, rather than only the silent permission prompt on first app load)
- **VonBot**: an automated account that reposts one trending gaming/anime/movie/superhero-news image a day (pulled from a handful of public RSS feeds — IGN, MyAnimeList, SlashFilm, ScreenRant) as a public post, so the feed stays active on its own between real posts — see `backend/src/lib/vonbot.js` and the "VonBot" step under Deploying below for how it's actually triggered
- **Messenger**: real-time 1:1 chat with typing indicators and online/offline presence, a photo/video attachment per message (same upload pipeline as posts), and a reply-to-message quote (tap ↩️ on any message, see `reply_to_id` in `database/schema.sql`)
- **Calls**: real audio/video calls over WebRTC, signaled through the same Socket.IO connection (see `backend/src/sockets/index.js` and `frontend/src/context/CallContext.jsx`)
- **Notifications**: an incoming call, video call, or new message vibrates the phone and — if the app isn't the focused tab — pops a native OS notification, routed through the installed PWA's own service worker so it actually shows up on iOS too (see `frontend/src/lib/notify.js`)
- **Block / unfriend**: blocking removes any friendship and stops messaging, feed visibility, and profile access in both directions from then on (see `backend/src/lib/blocks.js`); unfriending just ends the friendship, no re-adding needed to reconnect
- **Linked accounts**: Facebook/Instagram/TikTok/Snapchat handles shown as badges, plus an "I just posted" button that notifies friends with a link out — see the note below on why this isn't automatic
- **Share**: a real "Share to Facebook" button (Facebook's own share dialog, no API key needed); Instagram/TikTok don't allow outside apps to post into someone's feed at all, so those save the photo/video to the device and prompt the person to post it themselves

### Why some of this isn't fully automatic

Facebook, Instagram, TikTok, and Snapchat don't let outside apps read a user's (or their friends') feed anymore — Facebook/Instagram locked that down around 2018, and TikTok/Snapchat never opened it up. The same is true in reverse for posting: only Facebook has a public share-to-feed mechanism; Instagram has none, and TikTok's exists but requires a formally approved developer app. VonBook's honest version, both directions: friends link their handle, can ping friends that they posted somewhere with a link out, and can share to Facebook for real — everything else is "save it, then post it yourself." No scraping, no fake integration.

## Known limitations

- **Calls use a public STUN server only** (no TURN relay) — works on most home/mobile networks, but a call between two people on strict/symmetric NATs (some corporate or public wifi) may fail to connect. Adding a TURN server (e.g. a cheap one from Twilio or Metered) to `ICE_SERVERS` in `frontend/src/context/CallContext.jsx` would fix that if it comes up.
- **PWA icon is an SVG** (`frontend/public/icon.svg`, the alien sprite) — works for install-to-home-screen on Android/Chrome; iOS Safari's home screen icon support is more reliable with real PNGs. Swap in 192x192/512x512 PNGs there if you want a sharper icon on iPhone.
- **`intro-video.mp4` is ~7MB** — down from an original ~31MB (1080p, very high bitrate) by re-encoding to 720p with `ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -preset slow -crf 26 -c:a aac -b:a 128k -movflags +faststart out.mp4`; `+faststart` also lets playback begin before the whole file's downloaded. Still the single biggest thing a first-time visitor downloads, just a lot less painful on mobile data now.
- **VonBot pulls from mainstream outlets' own public RSS feeds (IGN, MyAnimeList, SlashFilm, ScreenRant), not Reddit, and never touches any personal account of yours or anyone else's** — Reddit was the original plan, but its API now requires an approved Devvit app plus written approval for anything that isn't a Reddit-hosted app, and there was never a reason to put your own Reddit login anywhere near a kids' app anyway. If one of these publishers changes or breaks its feed, VonBot just quietly stops pulling from that one (or all of them, worst case) — nothing else breaks, and there's no account of any kind that could be compromised.
- **VonBot's content isn't filtered beyond "it came from one of these four outlets"** — the feeds are normal entertainment/gaming journalism (not raw social media), but a headline or thumbnail about a mature-rated game or R-rated movie could still show up like it would on the outlet's own site. Worth spot-checking the feed occasionally if that matters for who's using this.
- **The "make public" warning's "don't show again" is per-browser** (`localStorage`), not per-account — a different device or a cleared browser will see the warning again once, even for the same person.
- **Native notifications only fire while something's actually running the app** — a backgrounded tab or an installed PWA in the background still counts, but a fully closed browser/app does not. True push-when-closed would need a different setup (a Push subscription per user + a `web-push` library on the backend), which this doesn't do.
- **A dev account can see anyone's login email on hover** (see `is_dev` on users, `GET /api/users/:username/email`, `frontend/src/components/DisplayName.jsx`) — a deliberate moderation tool, not a bug, but worth knowing it exists: emails never reach a non-dev browser (a separate on-demand endpoint, not baked into any list/feed response), but a dev account does see them for literally everyone.

## Project layout

```
VonBook/
  backend/          Express API + Socket.IO, PostgreSQL via `pg`
    src/
      routes/        one file per resource (auth, users, friends, posts, messages, vonbot, ...)
      sockets/       chat + webrtc signaling + presence
      middleware/     auth, csrf, uploads, error handling
      lib/            small shared helpers (blocks, friends, notify, sessions, cloudinary, rssFeeds, vonbot, linkPreview, ...)
  frontend/         React + Vite, mobile-first CSS, installable PWA
    src/
      pages/          one per screen
      components/     shared UI (avatar, post card, call overlay, intro splash, public-post warning, ...)
      context/        auth / socket / call / toast providers
      lib/            image normalization (HEIC/orientation fix), native notifications, public-post warning state
  database/
    schema.sql       the whole db schema, safe to re-run
  .github/workflows/ scheduled ping that triggers VonBot's posting tick
  render.yaml        Render Blueprint (backend + Postgres)
```
