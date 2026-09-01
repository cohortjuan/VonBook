import { Router } from 'express';
import { pool } from '../db/pool.js';
import { normalizeEmail } from '../lib/normalize.js';

export const contactsRouter = Router();

// POST /api/contacts/match { contacts: [{ name, emails: [...], phones: [...] }] }
//
// The frontend gets this list from the browser's native Contact Picker
// (navigator.contacts.select -- user explicitly grants access per pick, see
// frontend/src/pages/FindFriends.jsx) or from someone typing numbers/emails
// in by hand. Nothing here is ever written to the database: this is a
// one-shot lookup, not an address-book upload -- we match against existing
// accounts and immediately forget everything that *didn't* match, which is
// most of a typical phone contact list. Matching happens server-side (never
// send the whole users table to the client to match against locally) but
// the request body itself never touches disk either.
contactsRouter.post('/match', async (req, res, next) => {
  try {
    const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    if (contacts.length === 0) return res.json([]);
    if (contacts.length > 1000) {
      return res.status(400).json({ error: 'too many contacts in one request' });
    }

    const emails = new Set();
    const phones = new Set();
    for (const contact of contacts) {
      for (const e of contact.emails || []) {
        const normalized = normalizeEmail(e);
        if (normalized) emails.add(normalized);
      }
      for (const p of contact.phones || []) {
        const digits = typeof p === 'string' ? p.replace(/[^\d+]/g, '') : '';
        if (digits) phones.add(digits);
      }
    }

    if (emails.size === 0 && phones.size === 0) return res.json([]);

    const result = await pool.query(
      `SELECT id, username, display_name, avatar_url, is_founder, founder_title
       FROM users
       WHERE deleted_at IS NULL
         AND id <> $1
         AND (email = ANY($2::text[]) OR phone = ANY($3::text[]))
         AND NOT EXISTS (
           SELECT 1 FROM blocks
           WHERE (blocker_id = $1 AND blocked_id = users.id)
              OR (blocker_id = users.id AND blocked_id = $1)
         )`,
      [req.user.id, [...emails], [...phones]],
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});
