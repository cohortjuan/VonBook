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

Same two services as this folder's Whispers App project, but wired differently: VonBook's frontend talks to the Render backend **directly** (REST *and* the Socket.IO connection for chat/calls), rather than proxying `/api` through Vercel. That's what real-time features need — a WebSocket handshake can't be proxied through a Vercel rewrite the way a plain API call can. The cookie is set to `SameSite=None` in production specifically so it's still sent on that cross-site socket connection (see the comment on `resolveCookieOptions()` in `backend/src/lib/session.js`).

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
   
   Once it's deployed, copy the backend's `https://vonbook-backend-xxxx.onrender.com` URL — you need it next.

3. **Frontend, on Vercel**: New Project → import the same repo → set **Root Directory to `frontend`** (important, this is not a single-app repo) → add environment variables:
   - `VITE_API_URL` = `https://<your-render-url>/api`
   - `VITE_SOCKET_URL` = `https://<your-render-url>`
   
   Deploy. Copy the resulting `https://vonbook-xxxx.vercel.app` URL.

4. **Back on Render**: edit the `CORS_ORIGIN` env var to your real Vercel URL from step 3, save (this redeploys automatically). Without this the backend rejects every request from the deployed frontend.

5. **Persistent uploads — optional, only relevant on a paid Render plan**: on Render's free tier (the default, and what this project actually runs on), avatars/post photos/videos vanish every time the backend redeploys, because a plain web service's filesystem is ephemeral. There's no free-tier fix for this — it's a real limitation to just know about, not a missing setup step. If a paid instance is ever added later: backend service → **Disks** tab → Add Disk → mount path `/var/data/uploads` → add env var `UPLOAD_DIR_PATH` = `/var/data/uploads` (the upload code already reads this, see `backend/src/middleware/upload.js`).

**One honest caveat that's still true either way**: Render's **free** Postgres database expires after 90 days — Render emails a warning; upgrade it or take a `pg_dump` backup before then if you want to keep it going. (Unrelated to the Disk above — that's about the database, not file storage.)

## The founder account

Whoever signs up with the `FOUNDER_CLAIM_CODE` gets:
- A 👑 crown badge on their avatar everywhere (posts, comments, friends list, messages, notifications)
- Their display name in a gradient with a ✨
- A custom title under their name on their profile (defaults to "Founder & Birthday Star")
- An automatic site-wide "🎉 Happy Birthday!" banner + confetti, shown to *every* logged-in user, on the day that matches their `birthday` field (checked by month/day, so it recurs every year)
- Confetti on their own profile page on that day too

Give him the code, have him sign up with his real birthday set, and the rest is automatic.

## The intro

`frontend/public/intro-video.mp4` plays once, full-screen, the first time a signed-out visitor hits the site — in the last 5 seconds the alien logo, "VonBook", and "the gamers lounge" fade in over it, then it "powers off" like an old CRT and reveals the real landing page underneath (see `frontend/src/components/IntroSplash.jsx`). There's a mute toggle and a skip button.

## Easter eggs

- **Konami code** (↑ ↑ ↓ ↓ ← → ← → B A) anywhere in the app → confetti + a toast
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
- **Feed**: Instagram-style posts with photos/videos, captions, likes, comments — photos are converted to JPEG client-side before upload (fixes iPhone HEIC photos not rendering in non-Safari browsers, and sideways photos from EXIF orientation, see `frontend/src/lib/imageProcessing.js`)
- **Messenger**: real-time 1:1 chat with typing indicators and online/offline presence
- **Calls**: real audio/video calls over WebRTC, signaled through the same Socket.IO connection (see `backend/src/sockets/index.js` and `frontend/src/context/CallContext.jsx`)
- **Block / unfriend**: blocking removes any friendship and stops messaging, feed visibility, and profile access in both directions from then on (see `backend/src/lib/blocks.js`); unfriending just ends the friendship, no re-adding needed to reconnect
- **Linked accounts**: Facebook/Instagram/TikTok/Snapchat handles shown as badges, plus an "I just posted" button that notifies friends with a link out — see the note below on why this isn't automatic
- **Share**: a real "Share to Facebook" button (Facebook's own share dialog, no API key needed); Instagram/TikTok don't allow outside apps to post into someone's feed at all, so those save the photo/video to the device and prompt the person to post it themselves

### Why some of this isn't fully automatic

Facebook, Instagram, TikTok, and Snapchat don't let outside apps read a user's (or their friends') feed anymore — Facebook/Instagram locked that down around 2018, and TikTok/Snapchat never opened it up. The same is true in reverse for posting: only Facebook has a public share-to-feed mechanism; Instagram has none, and TikTok's exists but requires a formally approved developer app. VonBook's honest version, both directions: friends link their handle, can ping friends that they posted somewhere with a link out, and can share to Facebook for real — everything else is "save it, then post it yourself." No scraping, no fake integration.

## Known limitations

- **Calls use a public STUN server only** (no TURN relay) — works on most home/mobile networks, but a call between two people on strict/symmetric NATs (some corporate or public wifi) may fail to connect. Adding a TURN server (e.g. a cheap one from Twilio or Metered) to `ICE_SERVERS` in `frontend/src/context/CallContext.jsx` would fix that if it comes up.
- **PWA icon is an SVG** (`frontend/public/icon.svg`, the alien sprite) — works for install-to-home-screen on Android/Chrome; iOS Safari's home screen icon support is more reliable with real PNGs. Swap in 192x192/512x512 PNGs there if you want a sharper icon on iPhone.
- **`intro-video.mp4` is ~31MB** — fine for local dev and a fast connection, but worth knowing it's the single biggest thing a first-time visitor downloads. Compressing it (e.g. `ffmpeg -i in.mp4 -vcodec libx264 -crf 28 out.mp4`) to a few MB would make the intro load a lot faster on mobile data, if that ever comes up.

## Project layout

```
VonBook/
  backend/          Express API + Socket.IO, PostgreSQL via `pg`
    src/
      routes/        one file per resource (auth, users, friends, posts, messages, ...)
      sockets/       chat + webrtc signaling + presence
      middleware/     auth, csrf, uploads, error handling
      lib/            small shared helpers (blocks, friends, notify, sessions, ...)
  frontend/         React + Vite, mobile-first CSS, installable PWA
    src/
      pages/          one per screen
      components/     shared UI (avatar, post card, call overlay, intro splash, ...)
      context/        auth / socket / call / toast providers
      lib/            image normalization (HEIC/orientation fix)
  database/
    schema.sql       the whole db schema, safe to re-run
  render.yaml        Render Blueprint (backend + Postgres)
```
