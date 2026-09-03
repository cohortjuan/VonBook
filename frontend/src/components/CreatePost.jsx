import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { normalizeImageFiles } from '../lib/imageProcessing.js';
import { publicWarningDismissed } from '../lib/publicPostWarning.js';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete.js';
import PublicPostWarning from './PublicPostWarning.jsx';
import MentionSuggestions from './MentionSuggestions.jsx';

export default function CreatePost({ onCreated }) {
  const toast = useToast();
  const captionRef = useRef(null);
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [gameTag, setGameTag] = useState('');
  const [showGameTag, setShowGameTag] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [showPublicWarning, setShowPublicWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const mention = useMentionAutocomplete(captionRef, setCaption);

  // one object URL per picked file, regenerated (and the old ones revoked)
  // whenever the file list changes
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePublicToggle(e) {
    const checked = e.target.checked;
    if (checked && !publicWarningDismissed()) {
      setShowPublicWarning(true);
      return;
    }
    setIsPublic(checked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!caption.trim() && files.length === 0 && !linkUrl.trim()) return;
    setBusy(true);
    try {
      // converts iPhone HEIC photos (and anything else) to plain JPEGs so
      // they render for every viewer, not just Safari -- see lib/imageProcessing.js
      const normalized = await normalizeImageFiles(files);
      const formData = new FormData();
      formData.append('caption', caption.trim());
      if (gameTag.trim()) formData.append('game_tag', gameTag.trim());
      if (linkUrl.trim()) formData.append('link_url', linkUrl.trim());
      formData.append('is_public', String(isPublic));
      normalized.forEach((f) => formData.append('media', f));
      const post = await api.posts.create(formData);
      onCreated(post);
      setCaption('');
      setFiles([]);
      setGameTag('');
      setShowGameTag(false);
      setLinkUrl('');
      setShowLink(false);
      setIsPublic(false);
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-post" onSubmit={handleSubmit}>
      <textarea
        ref={captionRef}
        placeholder="What's going on? (tag someone with @username)"
        value={caption}
        onChange={(e) => {
          setCaption(e.target.value);
          mention.checkToken();
        }}
        onKeyUp={mention.checkToken}
        onClick={mention.checkToken}
        onBlur={mention.dismiss}
        rows={2}
        maxLength={2000}
      />
      <MentionSuggestions suggestions={mention.suggestions} onSelect={mention.selectSuggestion} />

      {showGameTag ? (
        <input
          className="game-tag-input"
          placeholder="Game (e.g. Fortnite, Halo Infinite)…"
          value={gameTag}
          onChange={(e) => setGameTag(e.target.value)}
          maxLength={100}
        />
      ) : (
        <button type="button" className="btn-link" onClick={() => setShowGameTag(true)}>
          🏆 Tag an achievement / game
        </button>
      )}

      {showLink ? (
        <input
          type="url"
          className="game-tag-input"
          placeholder="https://…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
      ) : (
        <button type="button" className="btn-link" onClick={() => setShowLink(true)}>
          🔗 Add a link
        </button>
      )}

      {files.length > 0 && (
        <div className="create-post-previews">
          {files.map((f, i) => (
            <div key={i} className="create-post-preview-item">
              {f.type.startsWith('video/') ? (
                <video src={previews[i]} muted className="create-post-preview-thumb" />
              ) : (
                <img src={previews[i]} alt="" className="create-post-preview-thumb" />
              )}
              <button type="button" className="create-post-preview-remove" onClick={() => removeFile(i)} aria-label="Remove photo/video">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="create-post-public-toggle">
        <input type="checkbox" checked={isPublic} onChange={handlePublicToggle} />
        {isPublic ? '🌐 Visible to everyone' : '🔒 Friends only'}
      </label>

      <div className="create-post-row">
        <label className="btn-secondary file-picker">
          📷 Photo/Video
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </label>
        <button className="btn-primary" type="submit" disabled={busy || (!caption.trim() && files.length === 0 && !linkUrl.trim())}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>

      {showPublicWarning && (
        <PublicPostWarning
          onCancel={() => setShowPublicWarning(false)}
          onConfirm={() => {
            setShowPublicWarning(false);
            setIsPublic(true);
          }}
        />
      )}
    </form>
  );
}
