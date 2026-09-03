const URL_RE = /(https?:\/\/[^\s]+)/g;

// turns any http(s) url sitting in plain caption text into a real
// clickable link -- used for VonBook's own caption text, but this is what
// actually makes VonBot's reposted article links clickable too, since a
// VonBot post is just a normal post whose caption happens to end with a url.
export function linkifyText(text) {
  if (!text) return text;
  return text.split(URL_RE).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
