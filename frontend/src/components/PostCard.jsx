import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from './Avatar.jsx';
import DisplayName from './DisplayName.jsx';
import ShareMenu from './ShareMenu.jsx';
import PublicPostWarning from './PublicPostWarning.jsx';
import { publicWarningDismissed } from '../lib/publicPostWarning.js';

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

function linkDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
  const [isPublic, setIsPublic] = useState(post.is_public);
  const [showPublicWarning, setShowPublicWarning] = useState(false);
  const [reported, setReported] = useState(false);
  const [hiddenAt, setHiddenAt] = useState(post.hidden_at);
  const mediaScrollRef = useRef(null);

  async function handleReport() {
    if (reported) return;
    setReported(true);
    try {
      await api.posts.report(post.id);
      toast('Post reported and hidden for review', 'success');
      // reported posts are hidden from everyone (see hidden_at) -- this
      // reporter included, so drop it out of the local feed rather than
      // leaving a post up that a reload wouldn't show anymore
      onRemoved?.(post.id);
    } catch (err) {
      setReported(false);
      toast(err.message, 'error');
    }
  }

  async function handleRelease() {
    const prev = hiddenAt;
    setHiddenAt(null);
    try {
      await api.posts.release(post.id);
      toast('Post released -- visible to everyone again', 'success');
    } catch (err) {
      setHiddenAt(prev);
      toast(err.message, 'error');
    }
  }

  async function setVisibility(nextPublic) {
    const prev = isPublic;
    setIsPublic(nextPublic);
    try {
      await api.posts.setVisibility(post.id, nextPublic);
    } catch (err) {
      setIsPublic(prev);
      toast(err.message, 'error');
    }
  }

  function handleVisibilityToggle() {
    if (isPublic) {
      setVisibility(false);
      return;
    }
    if (!publicWarningDismissed()) {
      setShowPublicWarning(true);
      return;
    }
    setVisibility(true);
  }

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

  // native scroll-snap does the actual swipe gesture handling (touch drag,
  // trackpad, momentum) -- this just keeps mediaIndex (for the active
  // thumbnail) in sync with wherever the user ends up scrolled to.
  function handleMediaScroll(e) {
    const el = e.currentTarget;
    if (!el.clientWidth) return;
    setMediaIndex(Math.round(el.scrollLeft / el.clientWidth));
  }

  function scrollToMedia(i) {
    const el = mediaScrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    setMediaIndex(i);
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

  return (
    <article className="post-card">
      {hiddenAt && (
        <div className="post-hidden-banner">
          <span>🚩 Reported -- hidden from everyone else</span>
          <button className="btn-secondary btn-small" onClick={handleRelease}>
            Release
          </button>
        </div>
      )}
      <div className="post-header">
        <Link to={`/u/${post.author_username}`} className="post-author-link">
          <Avatar user={{ display_name: post.author_display_name, avatar_url: post.author_avatar_url, is_founder: post.author_is_founder }} size={40} />
          <div>
            <DisplayName
              user={{
                display_name: post.author_display_name,
                is_founder: post.author_is_founder,
                founder_title: post.author_founder_title,
                username: post.author_username,
              }}
              className="post-author-name"
            />
            <div className="post-time">{timeAgo(post.created_at)}</div>
          </div>
        </Link>
        {(post.author_id === user.id || user.is_dev) && (
          <div className="post-owner-actions">
            {post.author_id === user.id && (
              <button
                className={`post-visibility-toggle ${isPublic ? 'public' : ''}`}
                onClick={handleVisibilityToggle}
                aria-label={isPublic ? 'Public -- visible to everyone. Tap to make friends-only' : 'Friends only. Tap to make public'}
              >
                {isPublic ? '🌐 Public' : '🔒 Friends'}
              </button>
            )}
            <button className="post-delete" onClick={handleDelete} aria-label="Delete post">
              🗑
            </button>
          </div>
        )}
      </div>

      {post.game_tag && <span className="game-tag-badge">🏆 {post.game_tag}</span>}
      {post.caption && <p className="post-caption">{post.caption}</p>}

      {media.length > 0 && (
        <div className="post-media">
          <div className="post-media-scroll" ref={mediaScrollRef} onScroll={handleMediaScroll} onDoubleClick={handleMediaDoubleClick}>
            {media.map((m, i) => (
              <div className="post-media-slide" key={i}>
                {m.media_type === 'video' ? (
                  <video src={getFileUrl(m.media_url)} controls className="post-media-content" />
                ) : (
                  <img src={getFileUrl(m.media_url)} alt="" className="post-media-content" />
                )}
              </div>
            ))}
          </div>
          {showHeart && <span className="like-heart-burst">❤️</span>}
          {media.length > 1 && <span className="post-media-count">{mediaIndex + 1}/{media.length}</span>}
          {media.length > 1 && (
            <div className="post-media-thumbs">
              {media.map((m, i) => (
                <button
                  key={i}
                  className={`post-media-thumb ${i === mediaIndex ? 'active' : ''}`}
                  onClick={() => scrollToMedia(i)}
                  aria-label={`Photo ${i + 1}`}
                >
                  {m.media_type === 'video' ? <video src={getFileUrl(m.media_url)} muted /> : <img src={getFileUrl(m.media_url)} alt="" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {post.link_url && (
        <a href={post.link_url} target="_blank" rel="noreferrer" className="post-link-card">
          <img src={post.link_image_url || '/icon.svg'} alt="" className="post-link-image" />
          <div className="post-link-info">
            <div className="post-link-title">{post.link_title || post.link_url}</div>
            <div className="post-link-domain">{linkDomain(post.link_url)}</div>
          </div>
        </a>
      )}

      <div className="post-actions">
        <button className={`post-action ${liked ? 'liked' : ''}`} onClick={toggleLike}>
          {liked ? '❤️' : '🤍'} {likeCount > 0 && likeCount}
        </button>
        <button className="post-action" onClick={loadComments}>
          💬 {post.comment_count > 0 && post.comment_count}
        </button>
        <ShareMenu post={post} />
        {post.author_id !== user.id && (
          <button className="post-action post-report" onClick={handleReport} disabled={reported} aria-label="Report post">
            🚩
          </button>
        )}
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
                  <DisplayName
                    user={{ display_name: c.author_display_name, is_founder: c.author_is_founder, username: c.author_username }}
                    className="comment-author"
                  />
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

      {showPublicWarning && (
        <PublicPostWarning
          onCancel={() => setShowPublicWarning(false)}
          onConfirm={() => {
            setShowPublicWarning(false);
            setVisibility(true);
          }}
        />
      )}
    </article>
  );
}
