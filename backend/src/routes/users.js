import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db/pool.js';
import { normalizeUsername } from '../lib/normalize.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { photoUpload, isRealImage } from '../middleware/upload.js';
import { finalizeUpload } from '../lib/cloudinary.js';

export const usersRouter = Router();

const PROFILE_FIELDS = `
  id, username, display_name, bio, avatar_url, cover_url, birthday,
  is_founder, founder_title, is_dev, now_playing, show_tagged, created_at
`;

// GET /api/users/search?q=partial -- for "add manually": search by
// username or display name. excludes yourself and anyone blocked either
// direction so a blocked user can't even be found to re-add.
usersRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) return res.json([]);

    const result = await pool.query(
      `SELECT ${PROFILE_FIELDS}
       FROM users
       WHERE deleted_at IS NULL
         AND id <> $1
         AND (username ILIKE $2 OR display_name ILIKE $2)
         AND NOT EXISTS (
           SELECT 1 FROM blocks
           WHERE (blocker_id = $1 AND blocked_id = users.id)
              OR (blocker_id = users.id AND blocked_id = $1)
         )
       ORDER BY (username = lower($3)) DESC, display_name
       LIMIT 20`,
      [req.user.id, `%${q}%`, q],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/meta/founder -- public info for the one founder account
// (if claimed yet), used to show the site-wide birthday banner/confetti
// when today matches his birthday. no relationship/block filtering here on
// purpose: every logged-in user should be able to see there IS a founder
// and wish them happy birthday, same as a real "who made this app" credit.
usersRouter.get('/meta/founder', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT username, display_name, avatar_url, birthday, founder_title
       FROM users WHERE is_founder = true AND deleted_at IS NULL LIMIT 1`,
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:username -- public profile, plus the viewer's
// relationship to them (friend/pending/none) so the frontend can render
// the right button without a second round trip.
usersRouter.get('/:username', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.params.username);
    const result = await pool.query(`SELECT ${PROFILE_FIELDS} FROM users WHERE username = $1 AND deleted_at IS NULL`, [
      username,
    ]);
    const profile = result.rows[0];
    if (!profile) return res.status(404).json({ error: 'user not found' });

    if (profile.id === req.user.id) {
      return res.json({ ...profile, relationship: 'self' });
    }

    if (await isBlockedEitherWay(req.user.id, profile.id)) {
      return res.status(404).json({ error: 'user not found' });
    }

    const friendship = await pool.query(
      `SELECT requester_id, status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [req.user.id, profile.id],
    );
    const row = friendship.rows[0];
    let relationship = 'none';
    if (row?.status === 'accepted') relationship = 'friends';
    else if (row?.status === 'pending' && row.requester_id === req.user.id) relationship = 'request_sent';
    else if (row?.status === 'pending') relationship = 'request_received';

    res.json({ ...profile, relationship });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:username/email -- dev only. a separate, on-demand
// endpoint rather than baking email into PROFILE_FIELDS/AUTHOR_COLUMNS,
// so an email address never leaves the server for a non-dev viewer under
// any circumstance -- see the hover tooltip in components/DisplayName.jsx.
usersRouter.get('/:username/email', async (req, res, next) => {
  try {
    if (!req.user.is_dev) return res.status(403).json({ error: 'not allowed' });
    const username = normalizeUsername(req.params.username);
    const result = await pool.query('SELECT email FROM users WHERE username = $1 AND deleted_at IS NULL', [username]);
    if (!result.rows[0]) return res.status(404).json({ error: 'user not found' });
    res.json({ email: result.rows[0].email });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me { display_name?, bio?, birthday?, now_playing?, show_tagged? }
// for bio/now_playing, sending an empty string clears the field -- only an
// actually-omitted (undefined -> null here) field leaves it unchanged
usersRouter.patch('/me', async (req, res, next) => {
  try {
    const { display_name, bio, birthday, now_playing, show_tagged } = req.body;
    const result = await pool.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         bio = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE bio END,
         birthday = CASE WHEN $4::text IS NOT NULL THEN $4::date ELSE birthday END,
         now_playing = CASE WHEN $5::text IS NOT NULL THEN NULLIF($5, '') ELSE now_playing END,
         show_tagged = CASE WHEN $6::boolean IS NOT NULL THEN $6 ELSE show_tagged END,
         updated_at = now()
       WHERE id = $1
       RETURNING ${PROFILE_FIELDS}`,
      [req.user.id, display_name?.trim() || null, bio ?? null, birthday ?? null, now_playing ?? null, show_tagged ?? null],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

function handlePhotoUpload(column) {
  return [
    photoUpload.single('photo'),
    async (req, res, next) => {
      try {
        if (!req.file) return res.status(400).json({ error: 'no photo uploaded' });

        const buffer = fs.readFileSync(req.file.path);
        if (!isRealImage(buffer)) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: 'that file is not a valid image' });
        }

        const url = await finalizeUpload(req.file.path, `/uploads/${req.file.filename}`);
        const result = await pool.query(
          `UPDATE users SET ${column} = $2, updated_at = now() WHERE id = $1 RETURNING ${PROFILE_FIELDS}`,
          [req.user.id, url],
        );
        res.json(result.rows[0]);
      } catch (err) {
        next(err);
      }
    },
  ];
}

usersRouter.post('/me/avatar', ...handlePhotoUpload('avatar_url'));
usersRouter.post('/me/cover', ...handlePhotoUpload('cover_url'));
