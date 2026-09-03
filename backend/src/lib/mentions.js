// matches the same username charset/length as lib/normalize.js's
// USERNAME_RE -- doesn't need to be exact since the caller looks up
// candidates against real accounts anyway, just close enough that a
// false-positive match is rare (an email-looking "@gmail.com" fragment
// etc. just won't resolve to a real username and gets silently ignored).
const MENTION_RE = /@([a-zA-Z0-9_]{3,20})\b/g;

// pulls unique, lowercased @username candidates out of free text (a post
// caption or comment body). doesn't verify they're real accounts -- the
// caller looks them up and only acts on ones that actually exist.
export function extractMentionedUsernames(text) {
  if (!text) return [];
  const found = new Set();
  for (const match of text.matchAll(MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}
