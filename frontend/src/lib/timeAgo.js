// compact relative time (e.g. "2h"), shared by the feed, conversation
// list, and notifications -- each passed its own small text differences
// (a "just now" vs "now" label, an " ago" suffix, an optional fallback to
// a plain date past some age) so this consolidates the logic without
// changing any page's actual displayed text.
export function timeAgo(iso, { justNowText = 'just now', suffix = '', fallbackAfterDays = null } = {}) {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return justNowText;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  if (fallbackAfterDays !== null && days >= fallbackAfterDays) return new Date(iso).toLocaleDateString();
  return `${days}d${suffix}`;
}

// full, unambiguous date + time -- used as a hover tooltip wherever
// timeAgo()'s compact label is shown, since "2h" alone doesn't answer
// "wait, what day was that actually."
export function fullDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
