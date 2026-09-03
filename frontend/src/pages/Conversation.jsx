import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';
import { normalizeImageFile } from '../lib/imageProcessing.js';

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
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null); // a message object | null
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const draftInputRef = useRef(null);

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

  // object URL for whatever's currently attached, cleaned up whenever it
  // changes or the attachment is cleared
  useEffect(() => {
    if (!attachment) {
      setAttachmentPreview(null);
      return;
    }
    const url = URL.createObjectURL(attachment);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  function handleDraftChange(e) {
    setDraft(e.target.value);
    socket?.emit('typing', { conversationId, isTyping: true });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket?.emit('typing', { conversationId, isTyping: false }), 1500);
  }

  async function handleFilePicked(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // same HEIC -> JPEG + orientation fix as post photos, see
    // lib/imageProcessing.js -- videos pass through untouched
    const normalized = file.type.startsWith('image/') ? await normalizeImageFile(file) : file;
    setAttachment(normalized);
  }

  function startReply(message) {
    setReplyingTo(message);
    draftInputRef.current?.focus();
  }

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body && !attachment) return;
    setDraft('');
    const file = attachment;
    const replyToId = replyingTo?.id;
    setAttachment(null);
    setReplyingTo(null);
    try {
      await api.messages.send(conversationId, body, file, replyToId);
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
          <div key={m.id} className={`message-bubble-row ${m.sender_id === user.id ? 'mine' : 'theirs'}`}>
            <div className={`message-bubble ${m.sender_id === user.id ? 'mine' : 'theirs'}`}>
              {m.reply_to_id && (
                <div className="message-reply-quote">
                  <span className="message-reply-quote-sender">
                    {m.reply_to_sender_id === user.id ? 'You' : otherUser?.display_name || 'them'}
                  </span>
                  {m.reply_to_body || (m.reply_to_media_type === 'video' ? '🎥 Video' : m.reply_to_media_type === 'image' ? '📷 Photo' : '')}
                </div>
              )}
              {m.media_url &&
                (m.media_type === 'video' ? (
                  <video src={getFileUrl(m.media_url)} controls className="message-media" />
                ) : (
                  <img src={getFileUrl(m.media_url)} alt="" className="message-media" />
                ))}
              {m.body && <div className={m.media_url ? 'message-body-with-media' : undefined}>{m.body}</div>}
            </div>
            <button type="button" className="message-reply-btn" onClick={() => startReply(m)} aria-label="Reply">
              ↩️
            </button>
          </div>
        ))}
        {typing && <div className="typing-indicator">typing…</div>}
        <div ref={bottomRef} />
      </div>

      {attachment && (
        <div className="composer-attachment-preview">
          {attachment.type.startsWith('video/') ? (
            <video src={attachmentPreview} muted className="composer-attachment-thumb" />
          ) : (
            <img src={attachmentPreview} alt="" className="composer-attachment-thumb" />
          )}
          <button type="button" className="composer-attachment-remove" onClick={() => setAttachment(null)} aria-label="Remove attachment">
            ✕
          </button>
        </div>
      )}

      {replyingTo && (
        <div className="composer-replying-to">
          <span className="composer-replying-to-text">
            Replying to <strong>{replyingTo.sender_id === user.id ? 'yourself' : otherUser?.display_name || 'them'}</strong>:{' '}
            {replyingTo.body || (replyingTo.media_type === 'video' ? '🎥 Video' : replyingTo.media_type === 'image' ? '📷 Photo' : '')}
          </span>
          <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
            ✕
          </button>
        </div>
      )}

      <form className="conversation-composer" onSubmit={send}>
        <label className="btn-secondary composer-attach" aria-label="Attach photo or video">
          📎
          <input type="file" accept="image/*,video/*" hidden onChange={handleFilePicked} />
        </label>
        <input ref={draftInputRef} value={draft} onChange={handleDraftChange} placeholder="Message…" maxLength={4000} />
        <button className="btn-primary" type="submit" disabled={!draft.trim() && !attachment}>
          Send
        </button>
      </form>
    </div>
  );
}
