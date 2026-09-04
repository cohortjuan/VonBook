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
import { timeAgo, fullDateTime } from '../lib/timeAgo.js';
import { linkifyText } from '../lib/linkify.jsx';
import { safeHref } from '../lib/safeUrl.js';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete.js';
import MentionSuggestions from './MentionSuggestions.jsx';

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
  const [replyingTo, setReplyingTo] = useState(null); // { id, displayName } | null
  const commentInputRef = useRef(null);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [isPublic, setIsPublic] = useState(post.is_public);
  const [showPublicWarning, setShowPublicWarning] = useState(false);
  const [reported, setReported] = useState(false);
  const [hiddenAt, setHiddenAt] = useState(post.hidden_at);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const mediaScrollRef = useRef(null);
  const mention = useMentionAutocomplete(commentInputRef, setCommentText);

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

  function startReply(comment) {
    setReplyingTo({ id: comment.parent_id || comment.id, displayName: comment.author_display_name });
    commentInputRef.current?.focus();
  }

  async function submitComment(e) {
    e.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    setCommentText('');
    const parentId = replyingTo?.id;
    setReplyingTo(null);
    try {
      const created = await api.posts.addComment(post.id, body, parentId);
      setComments((prev) => [...(prev || []), created]);
      setCommentCount((c) => c + 1);
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
            <div className="post-time" title={fullDateTime(post.created_at)}>
              {timeAgo(post.created_at, { fallbackAfterDays: 7 })}
            </div>
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
      {post.caption && <p className="post-caption">{linkifyText(post.caption)}</p>}

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

      {/* safeHref, not post.link_url directly -- a post saved before the
          backend's scheme check could carry a javascript: url, and React
          renders those into href as-is. An unsafe one still shows its
          preview, just not as a clickable link. */}
      {post.link_url &&
        (safeHref(post.link_url) ? (
          <a href={safeHref(post.link_url)} target="_blank" rel="noreferrer" className="post-link-card">
            <img src={post.link_image_url || '/icon.svg'} alt="" className="post-link-image" />
            <div className="post-link-info">
              <div className="post-link-title">{post.link_title || post.link_url}</div>
              <div className="post-link-domain">{linkDomain(post.link_url)}</div>
            </div>
          </a>
        ) : (
          <div className="post-link-card">
            <img src={post.link_image_url || '/icon.svg'} alt="" className="post-link-image" />
            <div className="post-link-info">
              <div className="post-link-title">{post.link_title || post.link_url}</div>
              <div className="post-link-domain muted small">link hidden -- unsupported address</div>
            </div>
          </div>
        ))}

      <div className="post-actions">
        <button className={`post-action ${liked ? 'liked' : ''}`} onClick={toggleLike}>
          {liked ? '❤️' : '🤍'} {likeCount > 0 && likeCount}
        </button>
        <button className="post-action" onClick={loadComments}>
          💬 {commentCount > 0 && commentCount}
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
            comments
              .filter((c) => !c.parent_id)
              .map((c) => (
                <div key={c.id}>
                  <CommentRow comment={c} onReply={startReply} />
                  {comments
                    .filter((r) => r.parent_id === c.id)
                    .map((r) => (
                      <CommentRow key={r.id} comment={r} onReply={startReply} isReply />
                    ))}
                </div>
              ))
          )}
          {replyingTo && (
            <div className="comment-replying-to">
              Replying to <strong>{replyingTo.displayName}</strong>
              <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                ✕
              </button>
            </div>
          )}
          <MentionSuggestions suggestions={mention.suggestions} onSelect={mention.selectSuggestion} />
          <form onSubmit={submitComment} className="comment-form">
            <input
              ref={commentInputRef}
              value={commentText}
              onChange={(e) => {
                setCommentText(e.target.value);
                mention.checkToken();
              }}
              onKeyUp={mention.checkToken}
              onClick={mention.checkToken}
              onBlur={mention.dismiss}
              placeholder="Write a comment… (@username to tag)"
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

function CommentRow({ comment, onReply, isReply = false }) {
  return (
    <div className={`comment-row ${isReply ? 'comment-reply' : ''}`}>
      <Avatar
        user={{ display_name: comment.author_display_name, avatar_url: comment.author_avatar_url, is_founder: comment.author_is_founder }}
        size={isReply ? 22 : 28}
      />
      <div>
        <DisplayName
          user={{ display_name: comment.author_display_name, is_founder: comment.author_is_founder, username: comment.author_username }}
          className="comment-author"
        />
        <span className="comment-body">{linkifyText(comment.body)}</span>
        <div className="comment-meta">
          <span title={fullDateTime(comment.created_at)}>{timeAgo(comment.created_at)}</span>
          <button type="button" className="comment-reply-btn" onClick={() => onReply(comment)}>
            Reply
          </button>
        </div>
      </div>
    </div>
  );
}
