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
  const special = user?.is_founder || user?.is_dev;

  return (
    <span className={`avatar-wrap ${special ? 'gold-ring' : ''}`} style={{ width: size, height: size }}>
      {user?.avatar_url ? (
        // no explicit width/height here on purpose -- the .avatar class
        // fills 100% of whatever box the wrap actually has left after its
        // own border (see .profile-header .avatar-wrap's 4px border). A
        // hardcoded pixel size here ignored that border entirely, so the
        // image was rendering a few px larger than its ring on some sides
        // -- that's the "gap" that wasn't actually a gap, but the image
        // overflowing past where the ring was drawn.
        <img className="avatar" src={getFileUrl(user.avatar_url)} alt={user.display_name} />
      ) : (
        <span className="avatar avatar-fallback" style={{ fontSize: size * 0.4 }}>
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
