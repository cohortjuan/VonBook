// Defence in depth for anything user-supplied that ends up in an href.
// The backend refuses to store a non-http(s) url now (safeExternalUrl in
// backend/src/lib/normalize.js), but rows saved before that check existed
// are still in the database, and React does NOT sanitize href -- it renders
// `javascript:...` as-is (React 18 only logs a warning), which would run
// that script on our own origin for whoever clicks it.
//
// Returns the url when it's safe to link to, otherwise null, so callers can
// render the thing as plain text instead of a link.
export function safeHref(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    // resolved against our own origin so a relative path ("/u/bob") still
    // comes back http(s) and passes, rather than throwing
    const { protocol } = new URL(url, window.location.origin);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
