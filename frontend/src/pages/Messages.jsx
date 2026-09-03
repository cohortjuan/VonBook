import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';
import { timeAgo } from '../lib/timeAgo.js';

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
              <DisplayName
                user={{ display_name: c.other_display_name, is_founder: c.other_is_founder, username: c.other_username }}
                className="conversation-row-name"
              />
              <div className="conversation-row-preview">
                {c.last_message_body ||
                  (c.last_message_media_type ? (c.last_message_media_type === 'video' ? '🎥 Video' : '📷 Photo') : 'Say hi 👋')}
              </div>
            </div>
            <span className="muted small">{timeAgo(c.last_message_at, { justNowText: 'now' })}</span>
          </Link>
        );
      })}
    </div>
  );
}
