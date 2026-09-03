import { Router } from 'express';
import { runVonBotTick } from '../lib/vonbot.js';

export const vonbotRouter = Router();

// POST /api/vonbot/tick -- called by a scheduled GitHub Actions workflow a
// few times a day (.github/workflows/vonbot.yml), never by the frontend.
// Not mounted behind requireAuth/csrfProtection in app.js -- the caller has
// no VonBook session, so it's gated by a shared secret instead, the same
// one-off pattern the old migration endpoint used except this one's meant
// to stay: VonBot posting a few times a day is a real, ongoing feature.
vonbotRouter.post('/tick', async (req, res, next) => {
  try {
    const key = req.get('X-VonBot-Key');
    if (!process.env.VONBOT_KEY || key !== process.env.VONBOT_KEY) {
      return res.status(403).json({ error: 'not allowed' });
    }
    const posted = await runVonBotTick();
    res.json({ posted });
  } catch (err) {
    next(err);
  }
});
