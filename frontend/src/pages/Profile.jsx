import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getFileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';
import Confetti from '../components/Confetti.jsx';

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

function isTodayBirthday(birthdayStr) {
  if (!birthdayStr) return false;
  const b = new Date(birthdayStr);
  const today = new Date();
  return b.getUTCMonth() === today.getMonth() && b.getUTCDate() === today.getDate();
}

export default function Profile() {
  const { username } = useParams();
  const { user: me, refreshUser } = useAuth();
  const { startCall } = useCall();
  const toast = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState(null);
  const [linked, setLinked] = useState([]);
  const [busy, setBusy] = useState(false);

  const isSelf = profile?.relationship === 'self';

  const load = useCallback(async () => {
    setLoading(true);
    setProfile(null);
    setPosts(null);
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

  async function handleMessage() {
    try {
      const convo = await api.messages.openDirect(profile.id);
      navigate(`/messages/${convo.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className={`page profile-page ${profile.is_founder ? 'founder-profile' : ''}`}>
      {founderToday && <Confetti onDone={() => {}} />}

      <div className="profile-cover">
        {profile.cover_url && <img src={getFileUrl(profile.cover_url)} alt="" />}
      </div>

      <div className="profile-header">
        <Avatar user={profile} size={96} />
        <DisplayName user={profile} className="profile-name" />
        {profile.founder_title && <p className="founder-title">{profile.founder_title}</p>}
        <p className="profile-handle">@{profile.username}</p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {founderToday && <p className="profile-bday-banner">🎂 Happy Birthday!! 🎉</p>}
        {profile.now_playing && <p className="now-playing-badge">🎮 Playing {profile.now_playing}</p>}

        {linked.length > 0 && (
          <div className="linked-badges">
            {linked.map((l) => (
              <a key={l.platform} href={l.url || '#'} target="_blank" rel="noreferrer" className="linked-badge">
                {PLATFORM_ICON[l.platform]} {PLATFORM_LABEL[l.platform]}
              </a>
            ))}
          </div>
        )}

        <div className="profile-actions">
          {isSelf && (
            <Link className="btn-secondary" to="/settings">
              Edit profile
            </Link>
          )}
          {profile.relationship === 'none' && (
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

      <div className="profile-grid">
        {posts === null && <p className="muted center">Loading posts…</p>}
        {posts?.length === 0 && <p className="muted center">No posts yet.</p>}
        {posts?.map((post) => {
          const cover = post.media?.[0];
          return (
            <div key={post.id} className="grid-tile">
              {cover ? (
                cover.media_type === 'video' ? (
                  <video src={getFileUrl(cover.media_url)} muted />
                ) : (
                  <img src={getFileUrl(cover.media_url)} alt="" />
                )
              ) : (
                <div className="grid-tile-text">{post.caption}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
