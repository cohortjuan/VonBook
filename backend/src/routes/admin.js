import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db/pool.js';
import { photoUpload, isRealImage } from '../middleware/upload.js';
import { finalizeUpload } from '../lib/cloudinary.js';

export const adminRouter = Router();

// VonBot has no login session of its own (a real bcrypt hash of a random
// string nobody knows, see lib/vonbot.js) -- there's no "log in as VonBot
// and use Settings" path, so dev accounts get a narrow, VonBot-specific
// upload instead of a general edit-anyone's-profile backdoor.
function handleVonBotPhotoUpload(column) {
  return [
    (req, res, next) => {
      if (!req.user.is_dev) return res.status(403).json({ error: 'not allowed' });
      next();
    },
    photoUpload.single('photo'),
    async (req, res, next) => {
      try {
        if (!req.file) return res.status(400).json({ error: 'no photo uploaded' });

        const buffer = fs.readFileSync(req.file.path);
        if (!isRealImage(buffer)) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: 'that file is not a valid image' });
        }

        const vonbot = await pool.query("SELECT id FROM users WHERE username = 'vonbot' AND deleted_at IS NULL");
        if (!vonbot.rows[0]) {
          fs.unlink(req.file.path, () => {});
          return res
            .status(404)
            .json({ error: "vonbot doesn't have an account yet -- it's created automatically on its first successful posting tick" });
        }

        const url = await finalizeUpload(req.file.path, `/uploads/${req.file.filename}`);
        const result = await pool.query(
          `UPDATE users SET ${column} = $2, updated_at = now() WHERE id = $1 RETURNING id, username, avatar_url, cover_url`,
          [vonbot.rows[0].id, url],
        );
        res.json(result.rows[0]);
      } catch (err) {
        next(err);
      }
    },
  ];
}

adminRouter.post('/vonbot/avatar', ...handleVonBotPhotoUpload('avatar_url'));
adminRouter.post('/vonbot/cover', ...handleVonBotPhotoUpload('cover_url'));

// POST /api/admin/grant-dev -- flips is_dev on for whoever's calling this
// (never a different user -- there's no target id param on purpose).
// is_dev has no self-service claim path like FOUNDER_CLAIM_CODE does, so
// this stays around as the one way to grant it -- kept intentionally,
// not a one-time migration helper meant to be deleted after use.
adminRouter.post('/grant-dev', async (req, res, next) => {
  try {
    const key = req.get('X-Admin-Key');
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'not allowed' });
    }

    const result = await pool.query('UPDATE users SET is_dev = true WHERE id = $1 RETURNING id, username, is_dev', [
      req.user.id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
