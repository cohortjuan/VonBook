import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../lib/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// double-submit csrf check, tied to the session row (not a bare stateless
// double-submit): the frontend must send the X-CSRF-Token header with the
// same value as the vonbook_csrf cookie, AND that value has to match what's
// stored on the session row in the db (req.session.csrfToken, set by
// requireAuth). must run AFTER requireAuth.
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const headerToken = req.get(CSRF_HEADER_NAME);
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const sessionToken = req.session?.csrfToken;

  if (!headerToken || !sessionToken || headerToken !== cookieToken || headerToken !== sessionToken) {
    return res.status(403).json({ error: 'invalid or missing csrf token' });
  }

  next();
}
