import { generateToken } from './session.js';

// Socket.IO's handshake is a cross-site *subresource* request from the
// frontend's origin, the same kind of request modern browsers block
// third-party cookies on by default -- SameSite=None doesn't exempt a
// cookie from that, it only exempts it from the SameSite restriction
// specifically. So the socket can't just ride the session cookie the way
// the REST API does (that side is fixed differently -- see the comment on
// API_URL in frontend/src/api/client.js). Instead: the frontend asks for
// one of these over the already-working, same-origin (proxied) REST API,
// then hands it to the socket as an explicit auth payload (not a cookie)
// when connecting directly to the backend's own origin. One-time use, 30
// seconds to actually be redeemed -- it only ever needs to survive the
// instant between issuing it and the socket handshake that follows.
//
// Plain in-memory Map, not a db table: these are single-instance,
// seconds-lived, and losing them all on a restart is completely harmless
// (the frontend just asks for a new one) -- a real table would be pure
// overhead for something this ephemeral.
const TICKET_TTL_MS = 30 * 1000;
const tickets = new Map(); // ticket -> { userId, expiresAt }

export function issueSocketTicket(userId) {
  const ticket = generateToken();
  tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

// one-time use: redeeming deletes it immediately, whether or not it was
// still valid, so a leaked/replayed ticket can't be reused either
export function redeemSocketTicket(ticket) {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}
