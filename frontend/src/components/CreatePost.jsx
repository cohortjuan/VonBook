import { useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { normalizeImageFiles } from '../lib/imageProcessing.js';

export default function CreatePost({ onCreated }) {
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState([]);
  const [gameTag, setGameTag] = useState('');
  const [showGameTag, setShowGameTag] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!caption.trim() && files.length === 0) return;
    setBusy(true);
    try {
      // converts iPhone HEIC photos (and anything else) to plain JPEGs so
      // they render for every viewer, not just Safari -- see lib/imageProcessing.js
      const normalized = await normalizeImageFiles(files);
      const formData = new FormData();
      formData.append('caption', caption.trim());
      if (gameTag.trim()) formData.append('game_tag', gameTag.trim());
      normalized.forEach((f) => formData.append('media', f));
      const post = await api.posts.create(formData);
      onCreated(post);
      setCaption('');
      setFiles([]);
      setGameTag('');
      setShowGameTag(false);
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
        placeholder="What's going on?"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        rows={2}
        maxLength={2000}
      />

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
        {files.length > 0 && <span className="muted">{files.length} file(s) selected</span>}
        <button className="btn-primary" type="submit" disabled={busy || (!caption.trim() && files.length === 0)}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
