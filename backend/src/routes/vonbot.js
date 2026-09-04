import { Router } from 'express';
import { runVonBotTick, postVonBotAnnouncement } from '../lib/vonbot.js';

export const vonbotRouter = Router();

function checkVonBotKey(req, res) {
  const key = req.get('X-VonBot-Key');
  if (!process.env.VONBOT_KEY || key !== process.env.VONBOT_KEY) {
    res.status(403).json({ error: 'not allowed' });
    return false;
  }
  return true;
}

// POST /api/vonbot/tick -- called by a scheduled GitHub Actions workflow a
// few times a day (.github/workflows/vonbot.yml), never by the frontend.
// Not mounted behind requireAuth/csrfProtection in app.js -- the caller has
// no VonBook session, so it's gated by a shared secret instead, the same
// one-off pattern the old migration endpoint used except this one's meant
// to stay: VonBot posting a few times a day is a real, ongoing feature.
vonbotRouter.post('/tick', async (req, res, next) => {
  try {
    if (!checkVonBotKey(req, res)) return;
    const posted = await runVonBotTick();
    res.json({ posted });
  } catch (err) {
    next(err);
  }
});

// POST /api/vonbot/announce { caption } -- same shared-secret gate as
// /tick above, for a one-off human-written post (a feature announcement,
// etc.) instead of an automatic RSS repost. Kept separate from /tick since
// the caller supplies real copy here rather than just triggering a check
// against the feeds. Not exposed anywhere in the frontend -- there's no
// UI for this, it's meant to be called directly (curl, or a workflow_dispatch
// if that's ever worth setting up) for the rare occasion VonBot needs to
// say something specific.
vonbotRouter.post('/announce', async (req, res, next) => {
  try {
    if (!checkVonBotKey(req, res)) return;
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 2000) : '';
    if (!caption) return res.status(400).json({ error: 'caption required' });
    const postId = await postVonBotAnnouncement(caption);
    res.json({ postId });
  } catch (err) {
    next(err);
  }
});
