import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db/pool.js';
import { isParticipant, getOrCreateDirectConversation } from '../lib/conversations.js';
import { areFriends } from '../lib/friends.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';
import { mediaUpload } from '../middleware/upload.js';
import { finalizeUpload } from '../lib/cloudinary.js';

export const messagesRouter = Router();

// GET /api/messages/conversations -- every conversation you're in, with
// the other participant (1:1 only for now) and a preview of the last message
messagesRouter.get('/conversations', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.is_group, c.title,
              other.id AS other_user_id, other.username AS other_username,
              other.display_name AS other_display_name, other.avatar_url AS other_avatar_url,
              other.is_founder AS other_is_founder, other.is_dev AS other_is_dev,
              m.body AS last_message_body, m.media_type AS last_message_media_type,
              m.created_at AS last_message_at, m.sender_id AS last_message_sender_id,
              me.last_read_at
       FROM conversation_participants me
       JOIN conversations c ON c.id = me.conversation_id
       LEFT JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> $1
       LEFT JOIN users other ON other.id = op.user_id
       LEFT JOIN LATERAL (
         SELECT body, media_type, created_at, sender_id FROM messages
         WHERE conversation_id = c.id AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE me.user_id = $1
       ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/messages/conversations/direct/:userId -- get-or-create a 1:1
// thread with a friend. requires an accepted friendship (you can't dm a
// stranger) and no block either direction.
messagesRouter.post('/conversations/direct/:userId', async (req, res, next) => {
  try {
    const otherId = Number(req.params.userId);
    if (!Number.isInteger(otherId)) return res.status(400).json({ error: 'invalid user id' });
    if (otherId === req.user.id) return res.status(400).json({ error: "can't message yourself" });
    if (!(await areFriends(req.user.id, otherId))) return res.status(403).json({ error: 'you can only message friends' });
    if (await isBlockedEitherWay(req.user.id, otherId)) return res.status(403).json({ error: 'not available' });

    const conversationId = await getOrCreateDirectConversation(req.user.id, otherId);
    res.status(200).json({ id: conversationId });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/conversations/:id/messages?before=<messageId>
messagesRouter.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);
    if (!(await isParticipant(conversationId, req.user.id))) {
      return res.status(404).json({ error: 'conversation not found' });
    }

    const before = Number(req.query.before) || null;
    const result = await pool.query(
      `SELECT id, sender_id, body, media_url, media_type, created_at
       FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL AND ($2::int IS NULL OR id < $2)
       ORDER BY id DESC LIMIT 30`,
      [conversationId, before],
    );
    res.json(result.rows.reverse());
  } catch (err) {
    next(err);
  }
});

// POST /api/messages/conversations/:id/messages { body } and/or one file
// under field "media" (photo or short video clip, same upload pipeline as
// post media -- see middleware/upload.js)
messagesRouter.post('/conversations/:id/messages', mediaUpload.single('media'), async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const file = req.file || null;
    if (!body && !file) return res.status(400).json({ error: 'message needs text or a photo/video' });
    if (body.length > 4000) return res.status(400).json({ error: 'message is too long' });

    // multer already wrote `file` to disk before this handler ever ran, so
    // any early return below needs to clean it up itself -- otherwise a
    // rejected send (wrong conversation, blocked) leaves an orphaned file
    // that nothing else ever references.
    if (!(await isParticipant(conversationId, req.user.id))) {
      if (file) fs.unlink(file.path, () => {});
      return res.status(404).json({ error: 'conversation not found' });
    }

    // block check: any OTHER participant blocked either direction stops
    // the send -- covers the 1:1 case directly and is the right rule for
    // group chat too (a blocked pair just can't be in a room together)
    const others = await pool.query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
      [conversationId, req.user.id],
    );
    for (const { user_id: otherId } of others.rows) {
      if (await isBlockedEitherWay(req.user.id, otherId)) {
        if (file) fs.unlink(file.path, () => {});
        return res.status(403).json({ error: 'not available' });
      }
    }

    let mediaUrl = null;
    let mediaType = null;
    if (file) {
      mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      mediaUrl = await finalizeUpload(file.path, `/uploads/${file.filename}`);
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, media_url, media_type) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversation_id, sender_id, body, media_url, media_type, created_at`,
      [conversationId, req.user.id, body || null, mediaUrl, mediaType],
    );
    const message = result.rows[0];

    const io = req.app.get('io');
    if (io) io.to(`conversation:${conversationId}`).emit('message:new', message);

    for (const { user_id: recipientId } of others.rows) {
      await createNotification({ io, recipientId, actorId: req.user.id, type: 'message', payload: { conversationId } });
    }

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/messages/conversations/:id/read
messagesRouter.patch('/conversations/:id/read', async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);
    const result = await pool.query(
      `UPDATE conversation_participants SET last_read_at = now()
       WHERE conversation_id = $1 AND user_id = $2 RETURNING conversation_id`,
      [conversationId, req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'conversation not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
