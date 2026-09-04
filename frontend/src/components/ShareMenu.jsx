import { useRef, useState } from 'react';
import { getFileUrl } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

// Facebook has a real, no-API-key "share dialog" any website can open --
// this genuinely posts to the person's own Facebook. Instagram and TikTok
// have no equivalent: neither lets an outside website post into someone's
// feed without a formally-approved developer app (TikTok's Content Posting
// API, which needs app review) or don't offer one publicly at all
// (Instagram). The honest version for those two: save the photo/video to
// the phone, then the person posts it themselves in that app -- same
// "no scraping, no fake integration" principle as the linked-accounts ping.
export default function ShareMenu({ post }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const media = post.media?.[0];

  function shareText() {
    return post.game_tag ? `🏆 ${post.game_tag}` : post.caption || 'Check out VonBook!';
  }

  function shareToFacebook() {
    setOpen(false);
    const postUrl = `${window.location.origin}/post/${post.id}`;
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}&quote=${encodeURIComponent(shareText())}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=580,height=520');
  }

  async function saveForRepost(platformLabel) {
    setOpen(false);
    if (!media) {
      toast(`This post has no photo/video to save for ${platformLabel}`, 'error');
      return;
    }
    try {
      const res = await fetch(getFileUrl(media.media_url), { credentials: 'include' });
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = media.media_url.split('/').pop();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast(`Saved! ${platformLabel} doesn't let outside apps post for you -- open it and share from there.`, 'info');
    } catch {
      toast('Could not save the file', 'error');
    }
  }

  return (
    <div className="share-menu" ref={menuRef}>
      <button className="post-action" onClick={() => setOpen((v) => !v)}>
        📤
      </button>
      {open && (
        <>
          <button className="share-menu-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="share-menu-dropdown">
            <button onClick={shareToFacebook}>📘 Share to Facebook</button>
            <button onClick={() => saveForRepost('Instagram')} disabled={!media}>
              📸 Save for Instagram
            </button>
            <button onClick={() => saveForRepost('TikTok')} disabled={!media}>
              🎵 Save for TikTok
            </button>
          </div>
        </>
      )}
    </div>
  );
}
