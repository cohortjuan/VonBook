import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';

function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Messages() {
  const [conversations, setConversations] = useState(null);

  useEffect(() => {
    api.messages.conversations().then(setConversations).catch(() => setConversations([]));
  }, []);

  if (conversations === null) return <p className="muted center page">Loading…</p>;
  if (conversations.length === 0) {
    return <p className="muted center page">No conversations yet -- message a friend from their profile.</p>;
  }

  return (
    <div className="page messages-page">
      {conversations.map((c) => {
        const unread = c.last_message_at && (!c.last_read_at || new Date(c.last_message_at) > new Date(c.last_read_at));
        return (
          <Link key={c.id} to={`/messages/${c.id}`} className={`conversation-row ${unread ? 'unread' : ''}`}>
            <Avatar user={{ display_name: c.other_display_name, avatar_url: c.other_avatar_url, is_founder: c.other_is_founder }} size={48} />
            <div className="conversation-row-body">
              <DisplayName user={{ display_name: c.other_display_name, is_founder: c.other_is_founder }} className="conversation-row-name" />
              <div className="conversation-row-preview">
                {c.last_message_body ||
                  (c.last_message_media_type ? (c.last_message_media_type === 'video' ? '🎥 Video' : '📷 Photo') : 'Say hi 👋')}
              </div>
            </div>
            <span className="muted small">{timeAgo(c.last_message_at)}</span>
          </Link>
        );
      })}
    </div>
  );
}
