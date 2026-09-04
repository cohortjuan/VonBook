import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';
import Confetti from '../components/Confetti.jsx';
import ImageCropper from '../components/ImageCropper.jsx';
import { isTodayBirthday } from '../lib/birthday.js';
import { normalizeImageFile } from '../lib/imageProcessing.js';

const PLATFORM_LABEL = {
  psn: 'PlayStation',
  xbox: 'Xbox',
  pc: 'PC',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  other: 'Other',
};
const PLATFORM_ICON = { psn: '🎮', xbox: '🎮', pc: '🖥️', facebook: '📘', instagram: '📸', tiktok: '🎵', snapchat: '👻', other: '🔗' };

export default function Profile() {
  const { username } = useParams();
  const { user: me, refreshUser, logout } = useAuth();
  const { startCall } = useCall();
  const toast = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState(null);
  const [taggedPosts, setTaggedPosts] = useState(null);
  const [activeTab, setActiveTab] = useState('posts'); // 'posts' | 'tagged'
  const [linked, setLinked] = useState([]);
  const [busy, setBusy] = useState(false);
  // holds { kind: 'avatar'|'cover', file } while the crop modal is open,
  // same pattern as Settings.jsx's own photo upload -- only ever used for
  // VonBot's photos here, see canEditVonBotPhotos below
  const [cropTarget, setCropTarget] = useState(null);

  const isSelf = profile?.relationship === 'self';
  const isVonBot = profile?.username === 'vonbot';
  const canEditVonBotPhotos = me.is_dev && isVonBot;

  const load = useCallback(async () => {
    setLoading(true);
    setProfile(null);
    setPosts(null);
    setTaggedPosts(null);
    setActiveTab('posts');
    const [p, l] = await Promise.all([
      api.users.get(username).catch((err) => {
        toast(err.message, 'error');
        return null;
      }),
      api.linkedAccounts.forUser(username).catch(() => []),
    ]);
    setProfile(p);
    setLinked(l);
    setLoading(false);
    if (p) {
      api.posts
        .byUser(username)
        .then(setPosts)
        .catch(() => setPosts([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="muted center page">Loading profile…</p>;
  if (!profile) return <p className="muted center page">That profile isn't available.</p>;

  const founderToday = profile.is_founder && isTodayBirthday(profile.birthday);

  async function withBusy(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (isSelf) refreshUser();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  async function handleMessage() {
    try {
      const convo = await api.messages.openDirect(profile.id);
      navigate(`/messages/${convo.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function selectTab(tab) {
    setActiveTab(tab);
    if (tab === 'tagged' && taggedPosts === null) {
      api.posts
        .tagged(username)
        .then(setTaggedPosts)
        .catch(() => setTaggedPosts([]));
    }
  }

  async function handleVonBotPhotoPicked(kind, file) {
    if (!file) return;
    // same HEIC -> JPEG + orientation fix as Settings.jsx's own upload,
    // done before the cropper since its preview is a plain <img>
    const normalized = await normalizeImageFile(file);
    setCropTarget({ kind, file: normalized });
  }

  async function handleVonBotCropped(croppedFile) {
    const kind = cropTarget.kind;
    setCropTarget(null);
    const formData = new FormData();
    formData.append('photo', croppedFile);
    try {
      await (kind === 'avatar' ? api.admin.setVonBotAvatar(formData) : api.admin.setVonBotCover(formData));
      await load();
      toast(`VonBot's ${kind === 'avatar' ? 'avatar' : 'cover photo'} updated`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function copyHandle(handle, label) {
    try {
      await navigator.clipboard.writeText(handle);
      toast(`Copied ${label} tag: ${handle}`, 'success');
    } catch {
      // clipboard access blocked (permissions, insecure context, etc) --
      // the toast alone still shows the handle, so it's not a dead end
      toast(`${label} tag: ${handle}`, 'success');
    }
  }

  return (
    <div className={`page profile-page ${profile.is_founder ? 'founder-profile' : ''}`}>
      {founderToday && <Confetti onDone={() => {}} />}

      <div className="profile-cover">
        {profile.cover_url && <img src={getFileUrl(profile.cover_url)} alt="" />}
        {canEditVonBotPhotos && (
          <label className="profile-photo-edit profile-cover-edit">
            📷 Change cover
            <input type="file" accept="image/*" hidden onChange={(e) => handleVonBotPhotoPicked('cover', e.target.files[0])} />
          </label>
        )}
      </div>

      {cropTarget && (
        <ImageCropper
          file={cropTarget.file}
          aspect={cropTarget.kind === 'avatar' ? 1 : 3}
          shape={cropTarget.kind === 'avatar' ? 'circle' : 'rect'}
          onCancel={() => setCropTarget(null)}
          onCropped={handleVonBotCropped}
        />
      )}

      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <Avatar user={profile} size={96} />
          {canEditVonBotPhotos && (
            <label className="profile-photo-edit profile-avatar-edit" aria-label="Change VonBot's avatar">
              📷
              <input type="file" accept="image/*" hidden onChange={(e) => handleVonBotPhotoPicked('avatar', e.target.files[0])} />
            </label>
          )}
        </div>
        <DisplayName user={profile} className="profile-name" />
        {profile.founder_title && <p className="founder-title">{profile.founder_title}</p>}
        <p className="profile-handle">@{profile.username}</p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {founderToday && <p className="profile-bday-banner">🎂 Happy Birthday!! 🎉</p>}
        {profile.now_playing && <p className="now-playing-badge">🎮 Playing {profile.now_playing}</p>}

        {linked.length > 0 && (
          <div className="linked-badges">
            {linked.map((l) =>
              l.url ? (
                <a key={l.platform} href={l.url} target="_blank" rel="noreferrer" className="linked-badge" title={`@${l.handle}`}>
                  {PLATFORM_ICON[l.platform]} {PLATFORM_LABEL[l.platform]}
                </a>
              ) : (
                // gamer tags usually have no real profile url to link to --
                // a bare "#" href used to sit here and go nowhere. showing
                // the handle on hover and copying it on tap is actually
                // useful instead of a dead link.
                <button
                  key={l.platform}
                  type="button"
                  className="linked-badge"
                  title={`@${l.handle} -- tap to copy`}
                  onClick={() => copyHandle(l.handle, PLATFORM_LABEL[l.platform])}
                >
                  {PLATFORM_ICON[l.platform]} {PLATFORM_LABEL[l.platform]}
                </button>
              ),
            )}
          </div>
        )}

        <div className="profile-actions">
          {isSelf && (
            <>
              <Link className="btn-secondary" to="/settings">
                Edit profile
              </Link>
              <button className="btn-secondary" onClick={handleLogout}>
                Log out
              </button>
            </>
          )}
          {isVonBot && profile.relationship !== 'friends' && (
            <button className="btn-primary" onClick={handleMessage}>
              💬 Ask VonBot
            </button>
          )}
          {!isVonBot && profile.relationship === 'none' && (
            <button className="btn-primary" disabled={busy} onClick={() => withBusy(() => api.friends.sendRequest(profile.id))}>
              Add Friend
            </button>
          )}
          {profile.relationship === 'request_sent' && (
            <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.friends.decline(profile.id))}>
              Cancel Request
            </button>
          )}
          {profile.relationship === 'request_received' && (
            <>
              <button className="btn-primary" disabled={busy} onClick={() => withBusy(() => api.friends.accept(profile.id))}>
                Accept
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.friends.decline(profile.id))}>
                Decline
              </button>
            </>
          )}
          {profile.relationship === 'friends' && (
            <>
              <button className="btn-primary" onClick={handleMessage}>
                Message
              </button>
              <button className="btn-secondary" onClick={() => startCall(profile, 'audio')}>
                📞
              </button>
              <button className="btn-secondary" onClick={() => startCall(profile, 'video')}>
                🎥
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.friends.unfriend(profile.id))}>
                Unfriend
              </button>
            </>
          )}
          {!isSelf && (
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Block @${profile.username}? This removes any friendship and stops all contact both ways.`)) {
                  withBusy(() => api.friends.block(profile.id));
                }
              }}
            >
              Block
            </button>
          )}
        </div>
      </div>

      <div className="profile-tabs">
        <button className={`profile-tab ${activeTab === 'posts' ? 'active' : ''}`} onClick={() => selectTab('posts')}>
          Posts
        </button>
        <button className={`profile-tab ${activeTab === 'tagged' ? 'active' : ''}`} onClick={() => selectTab('tagged')}>
          Tagged
        </button>
      </div>

      <div className="profile-grid">
        {activeTab === 'posts' ? (
          <>
            {posts === null && <p className="muted center">Loading posts…</p>}
            {posts?.length === 0 && <p className="muted center">No posts yet.</p>}
            {posts?.map((post) => (
              <GridTile key={post.id} post={post} />
            ))}
          </>
        ) : (
          <>
            {taggedPosts === null && <p className="muted center">Loading…</p>}
            {taggedPosts?.length === 0 && <p className="muted center">No tagged posts yet.</p>}
            {taggedPosts?.map((post) => (
              <GridTile key={post.id} post={post} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function GridTile({ post }) {
  const cover = post.media?.[0];
  return (
    <Link to={`/post/${post.id}`} className="grid-tile">
      {cover ? (
        cover.media_type === 'video' ? (
          <video src={getFileUrl(cover.media_url)} muted />
        ) : (
          <img src={getFileUrl(cover.media_url)} alt="" />
        )
      ) : (
        <div className="grid-tile-text">{post.caption}</div>
      )}
    </Link>
  );
}
