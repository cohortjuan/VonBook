import { Router } from 'express';
import fs from 'fs';
import { pool } from '../db/pool.js';
import { isParticipant, getOrCreateDirectConversation } from '../lib/conversations.js';
import { areFriends } from '../lib/friends.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';
import { mediaUpload } from '../middleware/upload.js';
import { finalizeUpload } from '../lib/cloudinary.js';
import { askVonBot, getVonBotId, isSelfHarmMessage, isVonBotAIEnabled, SELF_HARM_RESPONSE } from '../lib/vonbotAI.js';

export const messagesRouter = Router();

// cheap in-memory cooldown so a burst of rapid messages doesn't blow
// through a free-tier AI quota in one go -- same "in-memory is fine at
// this scale" call as onlineSockets in sockets/index.js. resets on a
// server restart, which just means the first message after a deploy
// always gets an immediate reply -- harmless.
const lastAIReplyAt = new Map();
const AI_COOLDOWN_MS = 4000;

// fired off after a message send (never awaited by the request) -- if the
// other side of this 1:1 is VonBot, generates and posts a reply in the
// same conversation a moment later, same as a real person typing back.
// humanId is whoever just sent the triggering message, i.e. the recipient
// of VonBot's reply notification.
async function triggerVonBotReply(io, conversationId, humanId, otherParticipants, incomingBody) {
  if (otherParticipants.length !== 1) return; // 1:1 only, same as the rest of DMs today
  const vonbotId = await getVonBotId();
  if (!vonbotId || otherParticipants[0].user_id !== vonbotId) return;

  const last = lastAIReplyAt.get(conversationId) || 0;
  if (Date.now() - last < AI_COOLDOWN_MS) return;
  lastAIReplyAt.set(conversationId, Date.now());

  let replyBody;
  if (isSelfHarmMessage(incomingBody)) {
    replyBody = SELF_HARM_RESPONSE;
  } else {
    // stateful: Gemini keeps this conversation's history server-side
    // against its own interaction id, so only the new message plus that
    // id ever needs to be sent -- see lib/vonbotAI.js
    const convoResult = await pool.query('SELECT vonbot_interaction_id FROM conversations WHERE id = $1', [conversationId]);
    const previousInteractionId = convoResult.rows[0]?.vonbot_interaction_id || null;
    const { text, interactionId } = await askVonBot(incomingBody, previousInteractionId);
    replyBody = text;
    if (interactionId && interactionId !== previousInteractionId) {
      await pool.query('UPDATE conversations SET vonbot_interaction_id = $1 WHERE id = $2', [interactionId, conversationId]);
    }
  }

  const result = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
     RETURNING id, conversation_id, sender_id, body, media_url, media_type, reply_to_id, created_at`,
    [conversationId, vonbotId, replyBody],
  );
  const reply = result.rows[0];
  if (io) io.to(`conversation:${conversationId}`).emit('message:new', reply);
  await createNotification({ io, recipientId: humanId, actorId: vonbotId, type: 'message', payload: { conversationId } });
}

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
    // VonBot skips the friend requirement -- "Ask VonBot" is meant to be a
    // one-tap thing from his profile, not a friend-request round trip with
    // a bot. everyone else still needs an accepted friendship to DM.
    const isVonBot = otherId === (await getVonBotId());
    if (!isVonBot && !(await areFriends(req.user.id, otherId))) return res.status(403).json({ error: 'you can only message friends' });
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
      `SELECT m.id, m.sender_id, m.body, m.media_url, m.media_type, m.reply_to_id, m.created_at,
              r.body AS reply_to_body, r.sender_id AS reply_to_sender_id, r.media_type AS reply_to_media_type
       FROM messages m
       LEFT JOIN messages r ON r.id = m.reply_to_id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL AND ($2::int IS NULL OR m.id < $2)
       ORDER BY m.id DESC LIMIT 30`,
      [conversationId, before],
    );
    res.json(result.rows.reverse());
  } catch (err) {
    next(err);
  }
});

// POST /api/messages/conversations/:id/messages { body, reply_to_id? }
// and/or one file under field "media" (photo or short video clip, same
// upload pipeline as post media -- see middleware/upload.js)
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

    let replyToId = Number(req.body.reply_to_id) || null;
    let replyPreview = null;
    if (replyToId) {
      const replyToResult = await pool.query(
        'SELECT id, sender_id, body, media_type FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL',
        [replyToId, conversationId],
      );
      if (!replyToResult.rows[0]) {
        if (file) fs.unlink(file.path, () => {});
        return res.status(404).json({ error: 'message not found' });
      }
      replyPreview = replyToResult.rows[0];
    }

    let mediaUrl = null;
    let mediaType = null;
    if (file) {
      mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      mediaUrl = await finalizeUpload(file.path, `/uploads/${file.filename}`);
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, media_url, media_type, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, conversation_id, sender_id, body, media_url, media_type, reply_to_id, created_at`,
      [conversationId, req.user.id, body || null, mediaUrl, mediaType, replyToId],
    );
    // reply preview fields carried over from the lookup above rather than
    // re-queried -- same data, one less round trip
    const message = {
      ...result.rows[0],
      reply_to_body: replyPreview?.body ?? null,
      reply_to_sender_id: replyPreview?.sender_id ?? null,
      reply_to_media_type: replyPreview?.media_type ?? null,
    };

    const io = req.app.get('io');
    if (io) io.to(`conversation:${conversationId}`).emit('message:new', message);

    for (const { user_id: recipientId } of others.rows) {
      await createNotification({ io, recipientId, actorId: req.user.id, type: 'message', payload: { conversationId } });
    }

    if (isVonBotAIEnabled()) {
      triggerVonBotReply(io, conversationId, req.user.id, others.rows, body).catch((err) =>
        console.error('VonBot AI reply failed:', err.message),
      );
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
