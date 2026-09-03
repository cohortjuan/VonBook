import { Link } from 'react-router-dom';

// same charset/length as backend/src/lib/normalize.js's USERNAME_RE (3-20
// chars of [a-z0-9_], case folded when actually looked up server-side --
// this just needs to catch candidates for rendering, not validate them).
const TOKEN_RE = /(https?:\/\/[^\s]+|@[a-zA-Z0-9_]{3,20})/g;
const URL_TEST = /^https?:\/\//;
const MENTION_TEST = /^@[a-zA-Z0-9_]{3,20}$/;

// turns any http(s) url or @username sitting in plain caption/comment text
// into a real link -- url handling is what makes VonBot's reposted article
// links clickable too, since its posts are just normal posts whose caption
// happens to end with a url. a mention doesn't check the account actually
// exists before rendering as a link (the profile page itself 404s cleanly
// if it doesn't -- see Profile.jsx), same tradeoff most apps make rather
// than a live lookup on every render.
export function linkifyText(text) {
  if (!text) return text;
  return text.split(TOKEN_RE).map((part, i) => {
    if (URL_TEST.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }
    if (MENTION_TEST.test(part)) {
      return (
        <Link key={i} to={`/u/${part.slice(1).toLowerCase()}`} className="mention-link">
          {part}
        </Link>
      );
    }
    return part;
  });
}
