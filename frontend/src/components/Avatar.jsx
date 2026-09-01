import { getFileUrl } from '../api/client.js';

function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// the founder (birthday boy) gets a crown badge on his avatar everywhere it
// shows up -- posts, comments, friends list, messages, notifications. the
// gold ring is a separate, shared "special account" mark: founder always
// gets one, and so does anyone flagged is_dev (the person who built this),
// even though only the founder gets the crown on top of it.
export default function Avatar({ user, size = 40 }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const special = user?.is_founder || user?.is_dev;

  return (
    <span className={`avatar-wrap ${special ? 'gold-ring' : ''}`} style={{ width: size, height: size }}>
      {user?.avatar_url ? (
        <img className="avatar" style={style} src={getFileUrl(user.avatar_url)} alt={user.display_name} />
      ) : (
        <span className="avatar avatar-fallback" style={style}>
          {initials(user?.display_name)}
        </span>
      )}
      {user?.is_founder && (
        <span className="founder-crown" style={{ fontSize: Math.max(12, size * 0.4) }} title={user.founder_title || 'Founder'}>
          👑
        </span>
      )}
    </span>
  );
}
