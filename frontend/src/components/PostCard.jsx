import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from './Avatar.jsx';
import DisplayName from './DisplayName.jsx';
import ShareMenu from './ShareMenu.jsx';

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export default function PostCard({ post, onRemoved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [showHeart, setShowHeart] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [mediaIndex, setMediaIndex] = useState(0);

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      await (next ? api.posts.like(post.id) : api.posts.unlike(post.id));
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  }

  // easter egg-ish nicety: double-tap a photo to like it, instagram-style,
  // with a little heart burst
  function handleMediaDoubleClick() {
    if (!liked) toggleLike();
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 700);
  }

  async function loadComments() {
    setShowComments((v) => !v);
    if (!comments) {
      try {
        setComments(await api.posts.comments(post.id));
      } catch {
        setComments([]);
      }
    }
  }

  async function submitComment(e) {
    e.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    setCommentText('');
    try {
      const created = await api.posts.addComment(post.id, body);
      setComments((prev) => [...(prev || []), created]);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this post?')) return;
    try {
      await api.posts.remove(post.id);
      onRemoved?.(post.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const media = post.media || [];
  const current = media[mediaIndex];

  return (
    <article className="post-card">
      <div className="post-header">
        <Link to={`/u/${post.author_username}`} className="post-author-link">
          <Avatar user={{ display_name: post.author_display_name, avatar_url: post.author_avatar_url, is_founder: post.author_is_founder }} size={40} />
          <div>
            <DisplayName
              user={{ display_name: post.author_display_name, is_founder: post.author_is_founder, founder_title: post.author_founder_title }}
              className="post-author-name"
            />
            <div className="post-time">{timeAgo(post.created_at)}</div>
          </div>
        </Link>
        {post.author_id === user.id && (
          <button className="post-delete" onClick={handleDelete} aria-label="Delete post">
            🗑
          </button>
        )}
      </div>

      {post.game_tag && <span className="game-tag-badge">🏆 {post.game_tag}</span>}
      {post.caption && <p className="post-caption">{post.caption}</p>}

      {current && (
        <div className="post-media" onDoubleClick={handleMediaDoubleClick}>
          {current.media_type === 'video' ? (
            <video src={getFileUrl(current.media_url)} controls className="post-media-content" />
          ) : (
            <img src={getFileUrl(current.media_url)} alt="" className="post-media-content" />
          )}
          {showHeart && <span className="like-heart-burst">❤️</span>}
          {media.length > 1 && (
            <div className="post-media-dots">
              {media.map((m, i) => (
                <button
                  key={i}
                  className={`dot ${i === mediaIndex ? 'active' : ''}`}
                  onClick={() => setMediaIndex(i)}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="post-actions">
        <button className={`post-action ${liked ? 'liked' : ''}`} onClick={toggleLike}>
          {liked ? '❤️' : '🤍'} {likeCount > 0 && likeCount}
        </button>
        <button className="post-action" onClick={loadComments}>
          💬 {post.comment_count > 0 && post.comment_count}
        </button>
        <ShareMenu post={post} />
      </div>

      {showComments && (
        <div className="post-comments">
          {comments === null ? (
            <p className="muted">Loading…</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="comment-row">
                <Avatar user={{ display_name: c.author_display_name, avatar_url: c.author_avatar_url, is_founder: c.author_is_founder }} size={28} />
                <div>
                  <DisplayName user={{ display_name: c.author_display_name, is_founder: c.author_is_founder }} className="comment-author" />
                  <span className="comment-body">{c.body}</span>
                </div>
              </div>
            ))
          )}
          <form onSubmit={submitComment} className="comment-form">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              maxLength={500}
            />
            <button type="submit" disabled={!commentText.trim()}>
              Post
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
