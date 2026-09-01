import crypto from 'crypto';

// httpOnly session cookie -- client-side js literally cannot read this one
export const SESSION_COOKIE_NAME = 'vonbook_session';

// NOT httpOnly -- frontend js reads this cookie's value and echoes it back
// in the X-CSRF-Token request header on every state-changing request. this
// is the "double-submit" half of csrf protection; middleware/csrf.js checks
// header === cookie === the value stored on the session row in the db.
export const CSRF_COOKIE_NAME = 'vonbook_csrf';

export const CSRF_HEADER_NAME = 'X-CSRF-Token';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- this is a kid's social app, not a bank

// raw token: this is what goes in the cookie and what the client holds.
// never stored server-side in this form.
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// what actually gets stored in the sessions table -- same principle as
// hashing a password, a copy of the database alone shouldn't be enough to
// forge a valid session
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// explicit env override, else guess from NODE_ENV, so local dev (plain
// http, can't set Secure at all) and a real deploy both just work.
//
// SameSite=None in production, not Lax: unlike Whispers App (frontend
// proxies /api/* through its own Vercel domain, so the browser only ever
// talks to itself -- see that project's api/client.js), VonBook's frontend
// talks to the Render backend directly, including the Socket.IO
// connection that powers chat/calls/presence. A plain WebSocket handshake
// is a cross-site *subresource* request, not a top-level navigation --
// SameSite=Lax's one exemption -- so Lax would silently drop the session
// cookie on it and every socket connection would 401. None sends the
// cookie on both the (cross-site) socket handshake and the (also
// cross-site) REST calls alike; it requires Secure, which every real
// deploy has anyway (this is meaningless without https).
export function resolveCookieOptions() {
  const secureProd =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  const sameSite = process.env.COOKIE_SAMESITE || (secureProd ? 'none' : 'lax');

  return { secure: secureProd, sameSite };
}
