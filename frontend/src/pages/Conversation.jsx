import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';

export default function Conversation() {
  const { id } = useParams();
  const conversationId = Number(id);
  const { user } = useAuth();
  const { socket, isOnline } = useSocket();
  const { startCall } = useCall();
  const toast = useToast();

  const [messages, setMessages] = useState(null);
  const [other, setOther] = useState(null);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    setMessages(null);
    api.messages.history(conversationId).then(setMessages).catch(() => setMessages([]));
    api.messages.markRead(conversationId).catch(() => {});
    api.messages
      .conversations()
      .then((rows) => setOther(rows.find((r) => r.id === conversationId) || null))
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('conversation:join', conversationId);

    function onMessage(msg) {
      if (msg.conversation_id !== conversationId) return;
      setMessages((prev) => [...(prev || []), msg]);
      if (msg.sender_id !== user.id) api.messages.markRead(conversationId).catch(() => {});
    }
    function onTyping({ conversationId: cid, userId, isTyping }) {
      if (cid === conversationId && userId !== user.id) setTyping(isTyping);
    }

    socket.on('message:new', onMessage);
    socket.on('typing', onTyping);
    return () => {
      socket.emit('conversation:leave', conversationId);
      socket.off('message:new', onMessage);
      socket.off('typing', onTyping);
    };
  }, [socket, conversationId, user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleDraftChange(e) {
    setDraft(e.target.value);
    socket?.emit('typing', { conversationId, isTyping: true });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket?.emit('typing', { conversationId, isTyping: false }), 1500);
  }

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await api.messages.send(conversationId, body);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const otherUser = other
    ? { id: other.other_user_id, username: other.other_username, display_name: other.other_display_name, avatar_url: other.other_avatar_url, is_founder: other.other_is_founder }
    : null;

  return (
    <div className="page conversation-page">
      <div className="conversation-header">
        {otherUser && (
          <Link to={`/u/${otherUser.username}`} className="conversation-header-user">
            <Avatar user={otherUser} size={36} />
            <div>
              <DisplayName user={otherUser} className="conversation-header-name" />
              <div className="muted small">{isOnline(otherUser.id) ? 'Online' : 'Offline'}</div>
            </div>
          </Link>
        )}
        {otherUser && (
          <div className="conversation-header-actions">
            <button className="btn-secondary btn-small" onClick={() => startCall(otherUser, 'audio')}>
              📞
            </button>
            <button className="btn-secondary btn-small" onClick={() => startCall(otherUser, 'video')}>
              🎥
            </button>
          </div>
        )}
      </div>

      <div className="conversation-messages">
        {messages === null && <p className="muted center">Loading…</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`message-bubble ${m.sender_id === user.id ? 'mine' : 'theirs'}`}>
            {m.body}
          </div>
        ))}
        {typing && <div className="typing-indicator">typing…</div>}
        <div ref={bottomRef} />
      </div>

      <form className="conversation-composer" onSubmit={send}>
        <input value={draft} onChange={handleDraftChange} placeholder="Message…" maxLength={4000} />
        <button className="btn-primary" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
