import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { normalizeUsername, safeExternalUrl } from '../lib/normalize.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { getFriendIds } from '../lib/friends.js';
import { createNotification } from '../lib/notify.js';

export const linkedAccountsRouter = Router();

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'snapchat', 'psn', 'xbox', 'pc', 'other'];

// real cross-app feed access isn't something any outside app can get from
// Facebook/Instagram/TikTok/Snapchat anymore (see the "I posted" comment
// below) -- these are handles/links the user types in themselves, shown as
// badges on their profile, nothing pulled automatically.
linkedAccountsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT platform, handle, url, created_at FROM linked_accounts WHERE user_id = $1 ORDER BY platform',
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

linkedAccountsRouter.get('/user/:username', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.params.username);
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [username]);
    const target = userResult.rows[0];
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (target.id !== req.user.id && (await isBlockedEitherWay(req.user.id, target.id))) {
      return res.status(404).json({ error: 'user not found' });
    }

    const result = await pool.query(
      'SELECT platform, handle, url, created_at FROM linked_accounts WHERE user_id = $1 ORDER BY platform',
      [target.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// PUT /api/linked-accounts/:platform { handle, url? }
linkedAccountsRouter.put('/:platform', async (req, res, next) => {
  try {
    const platform = req.params.platform;
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'unknown platform' });

    const handle = typeof req.body.handle === 'string' ? req.body.handle.trim() : '';
    if (!handle) return res.status(400).json({ error: 'a handle or username is required' });
    // scheme-checked, not just trimmed -- this value is rendered into an
    // href on the profile page (see safeExternalUrl)
    const rawUrl = typeof req.body.url === 'string' ? req.body.url.trim() : '';
    const url = rawUrl ? safeExternalUrl(rawUrl) : null;
    if (rawUrl && !url) return res.status(400).json({ error: 'that profile link needs to be a normal http(s) web address' });

    const result = await pool.query(
      `INSERT INTO linked_accounts (user_id, platform, handle, url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, platform) DO UPDATE SET handle = EXCLUDED.handle, url = EXCLUDED.url
       RETURNING platform, handle, url, created_at`,
      [req.user.id, platform, handle, url],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

linkedAccountsRouter.delete('/:platform', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM linked_accounts WHERE user_id = $1 AND platform = $2', [req.user.id, req.params.platform]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// a light limiter so this can't be used to spam every friend repeatedly
const pingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'slow down -- you can only send a few of these at a time' },
});

// POST /api/linked-accounts/ping { platform, message? }
//
// The honest version of "see what your friends post on Facebook/Instagram/
// TikTok/Snapchat": those platforms don't let any outside app read a
// friend's feed automatically (locked down for privacy since roughly 2018
// for Facebook/Instagram; TikTok and Snapchat never opened that up at all).
// So instead of faking it, this lets someone deliberately announce "hey, I
// just posted something" -- every friend gets a notification with a link
// out to that platform. No scraping, no pretending to auto-detect a post
// that was never actually fetched.
linkedAccountsRouter.post('/ping', pingLimiter, async (req, res, next) => {
  try {
    const platform = req.body.platform;
    if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'unknown platform' });

    const linked = await pool.query('SELECT handle, url FROM linked_accounts WHERE user_id = $1 AND platform = $2', [
      req.user.id,
      platform,
    ]);
    if (linked.rows.length === 0) {
      return res.status(400).json({ error: `link your ${platform} account on your profile first` });
    }

    const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 200) : null;
    const io = req.app.get('io');
    const friendIds = await getFriendIds(req.user.id);

    await Promise.all(
      friendIds.map((friendId) =>
        createNotification({
          io,
          recipientId: friendId,
          actorId: req.user.id,
          type: 'platform_ping',
          payload: { platform, message, handle: linked.rows[0].handle, url: linked.rows[0].url },
        }),
      ),
    );

    res.status(200).json({ notified: friendIds.length });
  } catch (err) {
    next(err);
  }
});
