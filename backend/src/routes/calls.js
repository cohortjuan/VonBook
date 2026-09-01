import { Router } from 'express';
import { pool } from '../db/pool.js';

export const callsRouter = Router();

// GET /api/calls -- recent call history (both directions). the calls
// themselves are created/updated over the socket connection (see
// sockets/index.js) since that's where the live signaling already
// happens -- this is read-only history for the messenger UI.
callsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.conversation_id, c.call_type, c.status, c.started_at, c.ended_at,
              c.caller_id, caller.username AS caller_username, caller.display_name AS caller_display_name,
              c.callee_id, callee.username AS callee_username, callee.display_name AS callee_display_name
       FROM calls c
       JOIN users caller ON caller.id = c.caller_id
       JOIN users callee ON callee.id = c.callee_id
       WHERE c.caller_id = $1 OR c.callee_id = $1
       ORDER BY c.started_at DESC
       LIMIT 50`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});
