// emails and usernames are always stored + compared lowercased at the app
// level (see database/schema.sql's comment on the users table) instead of
// relying on a postgres extension like citext.
export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim().toLowerCase() : username;
}

export function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

// user-supplied links (a linked-account profile url, a link post) end up
// rendered into an href. `new URL()` on its own is NOT a sufficient check:
// it happily parses `javascript:` and `data:` urls, and React renders those
// straight into href (React 18 only warns), so a friend clicking someone's
// gamer-tag badge would run that person's script on our own origin, able to
// call this api as them. Only http/https ever gets stored.
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function safeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  // "myprofile.com/me" is what people actually type -- assume https rather
  // than rejecting it, or (worse) storing a scheme-less string that would
  // render as a same-site relative link. Anything with an explicit scheme
  // is left alone so the protocol check below is what decides.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
}
