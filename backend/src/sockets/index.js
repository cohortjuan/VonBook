import cookie from 'cookie';
import { pool } from '../db/pool.js';
import { SESSION_COOKIE_NAME, hashToken } from '../lib/session.js';
import { isParticipant, getOrCreateDirectConversation } from '../lib/conversations.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';
import { getFriendIds } from '../lib/friends.js';

// userId -> Set of live socket ids. purely in-memory: presence resets on
// server restart, which is fine, a stale "online" dot for a few seconds is
// harmless. lets more than one tab/device per user count as "online" until
// every one of them disconnects.
const onlineSockets = new Map();

function markOnline(userId, socketId) {
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socketId);
  return onlineSockets.get(userId).size === 1; // true if this is their first socket
}

function markOffline(userId, socketId) {
  const sockets = onlineSockets.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineSockets.delete(userId);
    return true; // true if that was their last socket
  }
  return false;
}

export function isUserOnline(userId) {
  return onlineSockets.has(userId);
}

// socket.io's own handshake doesn't run through express middleware, so
// requireAuth can't be reused directly -- this re-does the same session
// cookie lookup by hand, once, at connection time.
async function authenticateSocket(socket, next) {
  try {
    const raw = socket.handshake.headers.cookie;
    const parsed = raw ? cookie.parse(raw) : {};
    const token = parsed[SESSION_COOKIE_NAME];
    if (!token) return next(new Error('unauthorized'));

    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [hashToken(token)],
    );
    const user = result.rows[0];
    if (!user) return next(new Error('unauthorized'));

    socket.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function attachSockets(io) {
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);

    const isFirstSocket = markOnline(userId, socket.id);
    if (isFirstSocket) {
      const friendIds = await getFriendIds(userId);
      friendIds.forEach((friendId) => io.to(`user:${friendId}`).emit('presence:online', { userId }));
    }

    // --- chat: join/leave a conversation's room, relay typing indicators ---
    socket.on('conversation:join', async (conversationId) => {
      if (await isParticipant(conversationId, userId)) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('typing', async ({ conversationId, isTyping }) => {
      if (!(await isParticipant(conversationId, userId))) return;
      socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, isTyping: !!isTyping });
    });

    // --- webrtc call signaling: the server is a dumb relay. it never sees
    // audio/video, only the offer/answer/ICE candidate blobs peers need to
    // find each other directly. see frontend/src/context/CallContext.jsx
    // for the peer connection itself. ---
    socket.on('call:invite', async ({ toUserId, callType }) => {
      if (await isBlockedEitherWay(userId, toUserId)) return;
      const conversationId = await getOrCreateDirectConversation(userId, toUserId);
      const { rows } = await pool.query(
        `INSERT INTO calls (conversation_id, caller_id, callee_id, call_type, status)
         VALUES ($1, $2, $3, $4, 'missed') RETURNING id`,
        [conversationId, userId, toUserId, callType === 'video' ? 'video' : 'audio'],
      );
      const callId = rows[0].id;
      io.to(`user:${toUserId}`).emit('call:incoming', {
        callId,
        conversationId,
        callType,
        from: { id: userId, username: socket.user.username, display_name: socket.user.display_name, avatar_url: socket.user.avatar_url },
      });
    });

    socket.on('call:signal', ({ toUserId, callId, data }) => {
      io.to(`user:${toUserId}`).emit('call:signal', { fromUserId: userId, callId, data });
    });

    socket.on('call:accept', async ({ toUserId, callId }) => {
      io.to(`user:${toUserId}`).emit('call:accepted', { callId, fromUserId: userId });
    });

    socket.on('call:decline', async ({ toUserId, callId }) => {
      await pool.query(`UPDATE calls SET status = 'declined', ended_at = now() WHERE id = $1`, [callId]);
      io.to(`user:${toUserId}`).emit('call:declined', { callId, fromUserId: userId });
    });

    socket.on('call:end', async ({ toUserId, callId, wasConnected }) => {
      await pool.query(
        `UPDATE calls SET status = $2, ended_at = now() WHERE id = $1`,
        [callId, wasConnected ? 'completed' : 'missed'],
      );
      if (!wasConnected) {
        const { rows } = await pool.query(`SELECT caller_id, callee_id, call_type FROM calls WHERE id = $1`, [callId]);
        const call = rows[0];
        if (call) {
          await createNotification({
            io,
            recipientId: call.callee_id,
            actorId: call.caller_id,
            type: 'missed_call',
            payload: { callId, callType: call.call_type },
          });
        }
      }
      io.to(`user:${toUserId}`).emit('call:ended', { callId, fromUserId: userId });
    });

    socket.on('disconnect', async () => {
      const wasLastSocket = markOffline(userId, socket.id);
      if (wasLastSocket) {
        const friendIds = await getFriendIds(userId);
        friendIds.forEach((friendId) => io.to(`user:${friendId}`).emit('presence:offline', { userId }));
      }
    });
  });
}
