import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import Avatar from '../components/Avatar.jsx';
import DisplayName from '../components/DisplayName.jsx';

const TABS = ['Friends', 'Requests', 'Find', 'Blocked'];

// the browser's native contact picker -- the user explicitly grants access
// per-pick (a system UI, not something a website can silently read from).
// only Chrome on Android supports this today; everywhere else "Find" falls
// back to searching by username/name and adding manually, which always works.
const CONTACT_PICKER_SUPPORTED = typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

export default function Friends() {
  const [tab, setTab] = useState('Friends');

  return (
    <div className="page friends-page">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Friends' && <FriendsList />}
      {tab === 'Requests' && <RequestsList />}
      {tab === 'Find' && <FindFriends />}
      {tab === 'Blocked' && <BlockedList />}
    </div>
  );
}

function PersonRow({ person, right }) {
  return (
    <div className="person-row">
      <Link to={`/u/${person.username}`} className="person-row-link">
        <Avatar user={person} size={44} />
        <div>
          <DisplayName user={person} className="person-row-name" />
          <div className="muted small">{person.now_playing ? `🎮 Playing ${person.now_playing}` : `@${person.username}`}</div>
        </div>
      </Link>
      <div className="person-row-actions">{right}</div>
    </div>
  );
}

function FriendsList() {
  const [friends, setFriends] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.friends
      .list()
      .then(setFriends)
      .catch((err) => toast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (friends === null) return <p className="muted center">Loading…</p>;
  if (friends.length === 0) return <p className="muted center">No friends yet -- try the Find tab.</p>;

  return friends.map((f) => <PersonRow key={f.id} person={f} />);
}

function RequestsList() {
  const [incoming, setIncoming] = useState(null);
  const [sent, setSent] = useState(null);
  const toast = useToast();

  function reload() {
    api.friends.requests().then(setIncoming).catch(() => setIncoming([]));
    api.friends.sentRequests().then(setSent).catch(() => setSent([]));
  }

  useEffect(reload, []);

  async function act(fn) {
    try {
      await fn();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <h3>Incoming</h3>
      {incoming === null && <p className="muted center">Loading…</p>}
      {incoming?.length === 0 && <p className="muted small">No pending requests.</p>}
      {incoming?.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          right={
            <>
              <button className="btn-primary btn-small" onClick={() => act(() => api.friends.accept(p.id))}>
                Accept
              </button>
              <button className="btn-secondary btn-small" onClick={() => act(() => api.friends.decline(p.id))}>
                Decline
              </button>
            </>
          }
        />
      ))}

      <h3>Sent</h3>
      {sent?.length === 0 && <p className="muted small">No outgoing requests.</p>}
      {sent?.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          right={
            <button className="btn-secondary btn-small" onClick={() => act(() => api.friends.decline(p.id))}>
              Cancel
            </button>
          }
        />
      ))}
    </>
  );
}

function FindFriends() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [contactMatches, setContactMatches] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.users.search(query.trim()).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  async function sendRequest(userId) {
    try {
      await api.friends.sendRequest(userId);
      toast('Friend request sent', 'success');
      setResults((prev) => prev.filter((r) => r.id !== userId));
      setContactMatches((prev) => prev?.filter((r) => r.id !== userId) ?? prev);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function importContacts() {
    setImporting(true);
    try {
      // props: only what's needed to match an existing account. nothing
      // here is ever stored -- see backend/src/routes/contacts.js
      const props = ['name', 'email', 'tel'];
      const picked = await navigator.contacts.select(props, { multiple: true });
      const contacts = picked.map((c) => ({
        name: c.name?.[0],
        emails: c.email || [],
        phones: c.tel || [],
      }));
      const matches = await api.contacts.match(contacts);
      setContactMatches(matches);
      if (matches.length === 0) toast("None of those contacts are on VonBook yet", 'info');
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message || 'could not read contacts', 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <input
        className="search-input"
        placeholder="Search by name or @username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.map((r) => (
        <PersonRow
          key={r.id}
          person={r}
          right={
            <button className="btn-primary btn-small" onClick={() => sendRequest(r.id)}>
              Add
            </button>
          }
        />
      ))}

      <h3>From your contacts</h3>
      {CONTACT_PICKER_SUPPORTED ? (
        <button className="btn-secondary" onClick={importContacts} disabled={importing}>
          {importing ? 'Reading contacts…' : '📇 Import from Contacts'}
        </button>
      ) : (
        <p className="muted small">
          Your browser doesn't support picking contacts (this works on Chrome for Android). Search by name or username above instead,
          or type someone's number/email in manually below once you know it.
        </p>
      )}
      {contactMatches?.map((r) => (
        <PersonRow
          key={r.id}
          person={r}
          right={
            <button className="btn-primary btn-small" onClick={() => sendRequest(r.id)}>
              Add
            </button>
          }
        />
      ))}
    </>
  );
}

function BlockedList() {
  const [blocked, setBlocked] = useState(null);
  const toast = useToast();

  function reload() {
    api.friends.blocked().then(setBlocked).catch(() => setBlocked([]));
  }
  useEffect(reload, []);

  async function unblock(userId) {
    try {
      await api.friends.unblock(userId);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (blocked === null) return <p className="muted center">Loading…</p>;
  if (blocked.length === 0) return <p className="muted center">Nobody's blocked.</p>;

  return blocked.map((p) => (
    <PersonRow
      key={p.id}
      person={p}
      right={
        <button className="btn-secondary btn-small" onClick={() => unblock(p.id)}>
          Unblock
        </button>
      }
    />
  ));
}
