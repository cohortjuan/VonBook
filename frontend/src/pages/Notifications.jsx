import { useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client.js';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';

const LABEL = {
  friend_request: (n) => `sent you a friend request`,
  friend_accept: (n) => `accepted your friend request`,
  like: (n) => `liked your post`,
  comment: (n) => `commented on your post`,
  message: (n) => `sent you a message`,
  missed_call: (n) => `you missed a call`,
  platform_ping: (n) => `posted something new on ${n.payload?.platform || 'another app'}${n.payload?.message ? `: "${n.payload.message}"` : ''}`,
};

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function targetFor(n) {
  if (n.type === 'friend_request' || n.type === 'friend_accept') return '/friends';
  if (n.type === 'message') return '/messages';
  if (n.type === 'platform_ping' && n.payload?.url) return n.payload.url;
  if (n.actor_username) return `/u/${n.actor_username}`;
  return null;
}

export default function Notifications() {
  const [notifications, setNotifications] = useState(null);
  const navigate = useNavigate();
  const outletCtx = useOutletContext();

  useEffect(() => {
    api.notifications.list().then(setNotifications).catch(() => setNotifications([]));
    api.notifications.readAll().then(() => outletCtx?.refreshUnread?.());
  }, [outletCtx]);

  function handleClick(n) {
    const target = targetFor(n);
    if (!target) return;
    if (/^https?:\/\//.test(target)) {
      window.open(target, '_blank', 'noreferrer');
    } else {
      navigate(target);
    }
  }

  if (notifications === null) return <p className="muted center page">Loading…</p>;
  if (notifications.length === 0) return <p className="muted center page">No notifications yet.</p>;

  return (
    <div className="page notifications-page">
      {notifications.map((n) => (
        <button key={n.id} className={`notification-row ${!n.read_at ? 'unread' : ''}`} onClick={() => handleClick(n)}>
          <Avatar user={{ display_name: n.actor_display_name, avatar_url: n.actor_avatar_url, is_founder: n.actor_is_founder }} size={40} />
          <div className="notification-row-body">
            <span>
              <DisplayName user={{ display_name: n.actor_display_name || 'Someone', is_founder: n.actor_is_founder }} /> {LABEL[n.type]?.(n) || n.type}
            </span>
            <div className="muted small">{timeAgo(n.created_at)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
