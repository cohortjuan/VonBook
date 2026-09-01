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
