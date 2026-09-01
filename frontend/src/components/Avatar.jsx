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

// the founder (birthday boy) gets a crown badge on his avatar everywhere
// it shows up -- posts, comments, friends list, messages, notifications
export default function Avatar({ user, size = 40 }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };

  return (
    <span className="avatar-wrap" style={{ width: size, height: size }}>
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
