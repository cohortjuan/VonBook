# 👾 VonBook — the gamers lounge

A full social platform in one app: profiles and a feed, real-time chat, audio/video calls, and a gaming hub. Built as a birthday present, with a founder account for the birthday boy.

**🔴 Live: [von-book.vercel.app](https://von-book.vercel.app)** — React PWA on Vercel, Express + Socket.IO on Render, Postgres, media on Cloudinary.

## ✨ Features

**Feed & profiles**
- Posts with photo/video carousels, captions, likes, and threaded comment replies
- Profiles with avatar, cover photo, bio, and a "🎮 currently playing" status
- **Achievement posts** — tag a post with a game and attach the screenshot
- **@mentions** that notify the person and collect on their profile under a **Tagged** tab, with a privacy toggle to hide it from others
- **Link posts** with automatic Open Graph previews scraped server-side, SSRF-guarded, falling back to the VonBook logo
- Public or friends-only per post, with a one-time confirmation so going public is never an accident

**Chat & calls**
- Real-time 1:1 messaging with typing indicators, online presence, media attachments, and reply-to quotes
- Real **WebRTC audio and video calls**, signalled over the same Socket.IO connection
- Native OS notifications through the installed PWA's service worker — works on iOS

**Social graph**
- Friend requests, search, and contact import via the browser's native Contact Picker (nothing from a contact list is ever stored)
- Blocking that severs visibility in both directions, and gamer tags for PSN/Xbox/PC

**🤖 VonBot** — an automated member of the community
- Posts a trending gaming/anime/movie/superhero story a few times a day, pulled from public RSS feeds (IGN, MyAnimeList, SlashFilm, ScreenRant)
- **Ask VonBot** — DM him and he answers for real, powered by Google Gemini. No friend request needed
- Built for a teenage audience: anything matching self-harm language never reaches the AI at all and gets a fixed, human-written response pointing to a trusted adult and the 988 crisis line; everything else runs through Gemini's strictest content filters

**Moderation**
- Anyone can report a post; the first report hides it immediately and alerts every dev account, which can then restore or remove it

## 🥚 Easter eggs

- **Konami code** (↑↑↓↓←→←→BA) anywhere → confetti. On mobile, the same sequence works as swipes, then two taps
- **Tap the logo 3×** → a hidden, playable Space Invaders (it's also the 404 page)
- **Tap it 5×** → a few seconds of rainbow party mode
- **Double-tap a photo** → likes it with a heart burst
- Open devtools → there's a message waiting

*Don't spoil these for him.*

## 👑 The founder account

Whoever signs up with the `FOUNDER_CLAIM_CODE` becomes the permanent founder — claimable exactly once, enforced at the database level. They get a crown badge everywhere, a gradient display name, a custom title, and an automatic site-wide birthday banner with confetti shown to every user on their birthday.

## 🎬 The intro

A full-screen video plays once for first-time visitors. In the final seconds the logo, wordmark, and tagline fade in, then it powers off like an old CRT to reveal the landing page. Mute and skip are both there.

## 🛠️ Stack

React 18 + Vite (PWA, mobile-first) · Node + Express · PostgreSQL via `pg` · Socket.IO for chat/calls/presence · Cloudinary for media · plain CSS, no UI framework.

Sessions are opaque server-side tokens (not JWTs), revocable by deleting a row, with CSRF protection on every mutating request and bcrypt password hashing.

## ⚙️ Local setup

```bash
docker compose up -d              # Postgres on :5434, schema applied automatically
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Copy `backend/.env.example` to `.env` first and set `FOUNDER_CLAIM_CODE`. The schema re-applies safely on every boot — everything is `IF NOT EXISTS`.

## 🚀 Deploying

**Backend (Render):** New → Blueprint → this repo. `render.yaml` provisions the web service and Postgres together, prompting for `FOUNDER_CLAIM_CODE` and `CORS_ORIGIN`.

**Frontend (Vercel):** Import the same repo, set **Root Directory to `frontend`**, and add `VITE_SOCKET_URL` pointing at the Render URL. Then set `CORS_ORIGIN` on Render to the resulting Vercel URL.

REST calls are proxied through Vercel to Render (`frontend/vercel.json`), so the browser only ever makes same-origin requests — that's what keeps the session cookie working, since browsers block cross-site cookies regardless of `SameSite`. Socket.IO can't be proxied that way, so it connects directly and authenticates with a short-lived ticket instead.

**Media:** set `CLOUDINARY_URL` so uploads survive redeploys, served with automatic `q_auto,f_auto` optimization.

**VonBot (optional):** set `VONBOT_KEY` on Render and as a GitHub Actions secret so the scheduled workflow can trigger his posts. For Ask VonBot, add `VONBOT_AI_API_KEY` from Google AI Studio — the model is auto-detected, so it keeps working as Google's lineup changes.

### Good to know

- Render's free Postgres **expires after 90 days** — upgrade or `pg_dump` before then
- Render's free tier sleeps after 15 minutes idle, so the first request after a quiet spell takes ~50s to wake
- Backend changes need **Manual Deploy → Deploy latest commit**; auto-deploy doesn't reliably fire
- Dev accounts can see any user's email on hover — a deliberate moderation tool, never exposed to regular accounts

## 📁 Layout

```
backend/src/
  routes/       one file per resource (auth, users, friends, posts, messages, vonbot, ...)
  sockets/      chat, WebRTC signalling, presence
  middleware/   auth, csrf, uploads, errors
  lib/          blocks, friends, notifications, sessions, cloudinary, rssFeeds, vonbot, linkPreview
frontend/src/
  pages/ components/ context/ lib/
database/schema.sql        the whole schema, safe to re-run
.github/workflows/         scheduled VonBot trigger
render.yaml                Render Blueprint
```

## 🔗 Why some integrations aren't automatic

Facebook, Instagram, TikTok, and Snapchat no longer let outside apps read a user's feed, and only Facebook offers a public share-to-feed dialog. So VonBook does the honest version: link your handle, share to Facebook for real, and for the rest, save the media and post it yourself. No scraping, no fake integrations.
