import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// wraps a user's name in the founder's signature gradient + a little
// sparkle when it's him, plain text otherwise. for a dev account (see
// is_dev on users), hovering any name also lazy-fetches that person's
// login email and shows it as a native tooltip -- a separate on-demand
// request rather than baked into every api response, see
// GET /api/users/:username/email in routes/users.js.
export default function DisplayName({ user, className = '' }) {
  const { user: me } = useAuth();
  const [email, setEmail] = useState(null);

  if (!user) return null;

  const canPeek = me?.is_dev && user.username && user.username !== me.username;

  async function handleMouseEnter() {
    if (!canPeek || email) return;
    try {
      const res = await api.users.getEmail(user.username);
      setEmail(res.email);
    } catch {
      // not worth a toast over a hover tooltip -- just stays unset, so no
      // tooltip shows rather than a broken one
    }
  }

  const title = canPeek && email ? email : undefined;

  if (user.is_founder) {
    return (
      <span className={`founder-name ${className}`} title={title} onMouseEnter={handleMouseEnter}>
        {user.display_name} ✨
      </span>
    );
  }
  return (
    <span className={className} title={title} onMouseEnter={handleMouseEnter}>
      {user.display_name}
    </span>
  );
}
