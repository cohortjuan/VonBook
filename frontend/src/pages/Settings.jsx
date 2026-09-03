import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import ImageCropper from '../components/ImageCropper.jsx';
import PublicPostWarning from '../components/PublicPostWarning.jsx';
import { normalizeImageFile } from '../lib/imageProcessing.js';
import { requestNotificationPermission } from '../lib/notify.js';
import { getNotificationPrefs, setNotificationPref } from '../lib/notificationPrefs.js';
import { publicWarningDismissed } from '../lib/publicPostWarning.js';

const NOTIF_STATUS_LABEL = {
  granted: "✅ Enabled -- the categories checked below will vibrate + pop a notification when the app isn't the active tab.",
  denied: "🔕 Blocked -- you'll need to allow notifications for this site in your browser's settings to turn it back on.",
  default: "Not turned on yet.",
  unsupported: "Not supported in this browser.",
};

const NOTIF_CATEGORIES = [
  { key: 'calls', label: '📞 Calls & video calls' },
  { key: 'messages', label: '💬 Messages' },
  { key: 'reports', label: '🚩 Reports (dev only)', devOnly: true },
];

const GAMER_PLATFORMS = ['psn', 'xbox', 'pc'];
const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'snapchat', 'other'];
const PLATFORM_LABEL = {
  psn: 'PlayStation',
  xbox: 'Xbox',
  pc: 'PC (Steam/Epic/etc)',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  other: 'Other',
};

export default function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    display_name: user.display_name,
    bio: user.bio || '',
    birthday: user.birthday || '',
    now_playing: user.now_playing || '',
  });
  const [showTagged, setShowTagged] = useState(user.show_tagged !== false);
  const [linked, setLinked] = useState({});
  const [pingPlatform, setPingPlatform] = useState('');
  const [pingMessage, setPingMessage] = useState('');
  // holds { kind: 'avatar'|'cover', file } while the crop modal is open --
  // the raw picked file is never uploaded directly, only what the cropper
  // exports on confirm (see handleCropped below)
  const [cropTarget, setCropTarget] = useState(null);
  const [notifStatus, setNotifStatus] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [notifPrefs, setNotifPrefs] = useState(getNotificationPrefs);
  const [showBulkPublicWarning, setShowBulkPublicWarning] = useState(false);

  function toggleNotifCategory(category, enabled) {
    setNotificationPref(category, enabled);
    setNotifPrefs((prev) => ({ ...prev, [category]: enabled }));
  }

  useEffect(() => {
    api.linkedAccounts.mine().then((rows) => {
      const map = {};
      rows.forEach((r) => (map[r.platform] = r));
      setLinked(map);
    });
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    try {
      await api.users.updateMe(form);
      await refreshUser();
      toast('Profile updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function uploadPhoto(kind, file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);
    try {
      await (kind === 'avatar' ? api.users.uploadAvatar(formData) : api.users.uploadCover(formData));
      await refreshUser();
      toast(`${kind === 'avatar' ? 'Avatar' : 'Cover photo'} updated`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handlePhotoPicked(kind, file) {
    if (!file) return;
    // normalize (HEIC -> JPEG, EXIF orientation baked in) *before* handing
    // to the cropper -- its own preview is a plain <img>, same HEIC
    // decoding problem as a direct upload would've had. see
    // lib/imageProcessing.js for why this matters.
    const normalized = await normalizeImageFile(file);
    setCropTarget({ kind, file: normalized });
  }

  async function handleCropped(croppedFile) {
    const kind = cropTarget.kind;
    setCropTarget(null);
    // the cropper's canvas export is already a clean, correctly-oriented
    // JPEG -- normalizeImageFile's HEIC/orientation handling only matters
    // for the raw picked file, which the crop step already consumed
    await uploadPhoto(kind, croppedFile);
  }

  async function saveLinkedAccount(platform, handle, url) {
    if (!handle.trim()) return;
    try {
      const saved = await api.linkedAccounts.set(platform, { handle: handle.trim(), url: url.trim() });
      setLinked((prev) => ({ ...prev, [platform]: saved }));
      toast(`${PLATFORM_LABEL[platform]} linked`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeLinkedAccount(platform) {
    try {
      await api.linkedAccounts.remove(platform);
      setLinked((prev) => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendPing(e) {
    e.preventDefault();
    if (!pingPlatform) return;
    try {
      const res = await api.linkedAccounts.ping(pingPlatform, pingMessage);
      toast(`Notified ${res.notified} friend(s)`, 'success');
      setPingMessage('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  async function handleEnableNotifications() {
    setNotifStatus(await requestNotificationPermission());
  }

  async function toggleShowTagged(e) {
    const checked = e.target.checked;
    setShowTagged(checked);
    try {
      await api.users.updateMe({ show_tagged: checked });
      await refreshUser();
    } catch (err) {
      setShowTagged(!checked);
      toast(err.message, 'error');
    }
  }

  async function applyAllPostsVisibility(isPublic) {
    try {
      const res = await api.posts.setAllVisibility(isPublic);
      toast(`${res.updated} post${res.updated === 1 ? '' : 's'} updated`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleMakeAllPublic() {
    if (!publicWarningDismissed()) {
      setShowBulkPublicWarning(true);
      return;
    }
    applyAllPostsVisibility(true);
  }

  return (
    <div className="page settings-page">
      <h2>Edit Profile</h2>

      <div className="settings-photos">
        <label className="photo-upload">
          <Avatar user={user} size={80} />
          <span>Change avatar</span>
          <input type="file" accept="image/*" hidden onChange={(e) => handlePhotoPicked('avatar', e.target.files[0])} />
        </label>
        <label className="photo-upload cover-upload">
          {user.cover_url ? <img src={getFileUrl(user.cover_url)} alt="" /> : <span className="cover-placeholder">No cover photo</span>}
          <span>Change cover</span>
          <input type="file" accept="image/*" hidden onChange={(e) => handlePhotoPicked('cover', e.target.files[0])} />
        </label>
      </div>

      {cropTarget && (
        <ImageCropper
          file={cropTarget.file}
          aspect={cropTarget.kind === 'avatar' ? 1 : 3}
          shape={cropTarget.kind === 'avatar' ? 'circle' : 'rect'}
          onCancel={() => setCropTarget(null)}
          onCropped={handleCropped}
        />
      )}

      <form onSubmit={saveProfile} className="auth-form">
        <label>
          Display name
          <input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
        </label>
        <label>
          Bio
          <textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={3} maxLength={300} />
        </label>
        <label>
          Birthday
          <input type="date" value={form.birthday || ''} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} />
        </label>
        <label>
          🎮 Currently playing
          <input
            value={form.now_playing}
            onChange={(e) => setForm((f) => ({ ...f, now_playing: e.target.value }))}
            placeholder="e.g. Fortnite, Minecraft…"
            maxLength={100}
          />
        </label>
        <button className="btn-primary" type="submit">
          Save changes
        </button>
      </form>

      <h2>Notifications</h2>
      <p className="muted">{NOTIF_STATUS_LABEL[notifStatus] || NOTIF_STATUS_LABEL.unsupported}</p>
      {notifStatus === 'default' && (
        <button className="btn-secondary" onClick={handleEnableNotifications}>
          Enable notifications
        </button>
      )}
      <div className="notif-categories">
        {NOTIF_CATEGORIES.filter((c) => !c.devOnly || user.is_dev).map((c) => (
          <label key={c.key} className="notif-category-row">
            <input
              type="checkbox"
              checked={notifPrefs[c.key]}
              onChange={(e) => toggleNotifCategory(c.key, e.target.checked)}
            />
            {c.label}
          </label>
        ))}
      </div>

      <h2>Post Privacy</h2>
      <p className="muted">
        Bulk-update every post you've already made. New posts still default to friends-only regardless of what you pick here.
      </p>
      <div className="settings-bulk-visibility">
        <button className="btn-secondary" onClick={handleMakeAllPublic}>
          🌐 Make all posts public
        </button>
        <button className="btn-secondary" onClick={() => applyAllPostsVisibility(false)}>
          🔒 Make all posts friends-only
        </button>
      </div>

      <label className="notif-category-row">
        <input type="checkbox" checked={showTagged} onChange={toggleShowTagged} />
        Show posts I'm tagged in on my profile
      </label>
      <p className="muted small">
        Off just hides the Tagged section from other people viewing your profile -- you still get notified when someone @tags you
        either way, and you can still see it yourself.
      </p>

      <h2>Gamer Tags</h2>
      <p className="muted">Link your PSN, Xbox, and PC tags so friends can find and add you on other platforms.</p>
      {GAMER_PLATFORMS.map((platform) => (
        <LinkedAccountRow
          key={platform}
          platform={platform}
          existing={linked[platform]}
          onSave={saveLinkedAccount}
          onRemove={removeLinkedAccount}
        />
      ))}

      <h2>Linked Accounts</h2>
      <p className="muted">
        VonBook can't automatically read your posts on other apps -- they don't allow that. Link your handle here so friends can find
        you, and use the button below to let friends know when you've posted somewhere new.
      </p>
      {SOCIAL_PLATFORMS.map((platform) => (
        <LinkedAccountRow
          key={platform}
          platform={platform}
          existing={linked[platform]}
          onSave={saveLinkedAccount}
          onRemove={removeLinkedAccount}
        />
      ))}

      <form onSubmit={sendPing} className="auth-form">
        <label>
          Announce a new post to friends
          <select value={pingPlatform} onChange={(e) => setPingPlatform(e.target.value)}>
            <option value="">Choose platform…</option>
            {Object.keys(linked).map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Optional message
          <input value={pingMessage} onChange={(e) => setPingMessage(e.target.value)} placeholder="just posted something!" maxLength={200} />
        </label>
        <button className="btn-primary" type="submit" disabled={!pingPlatform}>
          Notify friends
        </button>
      </form>

      <button className="btn-secondary logout-btn" onClick={handleLogout}>
        Log out
      </button>

      {showBulkPublicWarning && (
        <PublicPostWarning
          onCancel={() => setShowBulkPublicWarning(false)}
          onConfirm={() => {
            setShowBulkPublicWarning(false);
            applyAllPostsVisibility(true);
          }}
        />
      )}
    </div>
  );
}

function LinkedAccountRow({ platform, existing, onSave, onRemove }) {
  const [handle, setHandle] = useState(existing?.handle || '');
  const [url, setUrl] = useState(existing?.url || '');

  return (
    <div className="linked-row">
      <span className="linked-row-label">{PLATFORM_LABEL[platform]}</span>
      <input placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <input placeholder="profile link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="button" className="btn-secondary" onClick={() => onSave(platform, handle, url)}>
        Save
      </button>
      {existing && (
        <button type="button" className="btn-link" onClick={() => onRemove(platform)}>
          Remove
        </button>
      )}
    </div>
  );
}
