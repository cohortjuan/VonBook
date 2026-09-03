// tiny wrapper around fetch so components don't deal with json headers /
// csrf / error handling every single time. same pattern as this course's
// other apps: the session lives in an httpOnly cookie the backend manages
// entirely, and vonbook_csrf is the deliberately-readable half of the
// double-submit csrf check.
//
// Relative ("/api") in prod by default, same as Whispers App -- vercel.json
// rewrites /api/* and /uploads/* to the Render backend, so the browser only
// ever talks to this site's own origin. That's not just tidiness: the
// session cookie set by a *different* registrable domain (onrender.com) is
// a third-party cookie from a page served at vercel.app, and modern
// browsers (Safari/Firefox always, Chrome increasingly) block those by
// default regardless of SameSite=None -- login would appear to succeed
// (the response body has the user), but the very next request silently
// wouldn't carry the cookie at all. Same-origin via the proxy sidesteps
// that entirely. Socket.IO can't be proxied the same way (see
// context/SocketContext.jsx for how that connection authenticates instead).
const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api')).replace(
  /\/$/,
  '',
);

const CSRF_COOKIE = 'vonbook_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }),
  };

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie(CSRF_COOKIE);
    if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  }

  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers,
    ...options,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `request failed with status ${res.status}`);
  }

  return data;
}

// cloudinary's automatic quality/format optimization (q_auto picks the
// smallest quality that still looks right, f_auto picks the best format
// per browser -- webp/avif for images, whatever the browser actually
// supports for video) -- a url transformation, not an upload-time setting,
// so it applies retroactively to everything already uploaded too. only
// touches cloudinary's own /image/upload/ or /video/upload/ urls; VonBot's
// rss-sourced images (ign, screenrant, ...) are absolute urls on other
// hosts and pass through the branch below untouched.
const CLOUDINARY_UPLOAD_RE = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(?!q_auto)(.*)$/;

// absolute urls (an external avatar someone linked, before upload support
// existed, or VonBot's rss-sourced images) pass through unchanged aside
// from the cloudinary optimization above; anything else is a path this
// api served under /uploads
export function getFileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    const cloudinaryMatch = CLOUDINARY_UPLOAD_RE.exec(path);
    return cloudinaryMatch ? `${cloudinaryMatch[1]}q_auto,f_auto/${cloudinaryMatch[2]}` : path;
  }
  const base = API_URL.replace(/\/api\/?$/, '');
  return `${base}${path}`;
}

export const api = {
  auth: {
    me: () => request('/auth/me'),
    signup: (body) => request('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
    login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (token, password) =>
      request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
    // short-lived, one-time ticket for the socket handshake -- see
    // context/SocketContext.jsx for why the socket can't just rely on the
    // cookie the way the REST calls above do
    socketTicket: () => request('/auth/socket-ticket'),
  },
  users: {
    search: (q) => request(`/users/search?q=${encodeURIComponent(q)}`),
    getFounder: () => request('/users/meta/founder'),
    get: (username) => request(`/users/${encodeURIComponent(username)}`),
    getEmail: (username) => request(`/users/${encodeURIComponent(username)}/email`),
    updateMe: (body) => request('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
    uploadAvatar: (formData) => request('/users/me/avatar', { method: 'POST', body: formData }),
    uploadCover: (formData) => request('/users/me/cover', { method: 'POST', body: formData }),
  },
  friends: {
    list: () => request('/friends'),
    requests: () => request('/friends/requests'),
    sentRequests: () => request('/friends/requests/sent'),
    blocked: () => request('/friends/blocked'),
    sendRequest: (userId) => request(`/friends/${userId}/request`, { method: 'POST' }),
    accept: (userId) => request(`/friends/${userId}/accept`, { method: 'POST' }),
    decline: (userId) => request(`/friends/${userId}/decline`, { method: 'POST' }),
    unfriend: (userId) => request(`/friends/${userId}`, { method: 'DELETE' }),
    block: (userId) => request(`/friends/${userId}/block`, { method: 'POST' }),
    unblock: (userId) => request(`/friends/${userId}/block`, { method: 'DELETE' }),
  },
  contacts: {
    match: (contacts) => request('/contacts/match', { method: 'POST', body: JSON.stringify({ contacts }) }),
  },
  posts: {
    feed: (before) => request(`/posts/feed${before ? `?before=${before}` : ''}`),
    byUser: (username) => request(`/posts/user/${encodeURIComponent(username)}`),
    create: (formData) => request('/posts', { method: 'POST', body: formData }),
    setVisibility: (postId, isPublic) => request(`/posts/${postId}`, { method: 'PATCH', body: JSON.stringify({ is_public: isPublic }) }),
    setAllVisibility: (isPublic) => request('/posts/me/visibility', { method: 'PATCH', body: JSON.stringify({ is_public: isPublic }) }),
    remove: (postId) => request(`/posts/${postId}`, { method: 'DELETE' }),
    report: (postId) => request(`/posts/${postId}/report`, { method: 'POST' }),
    release: (postId) => request(`/posts/${postId}/release`, { method: 'POST' }),
    like: (postId) => request(`/posts/${postId}/like`, { method: 'POST' }),
    unlike: (postId) => request(`/posts/${postId}/like`, { method: 'DELETE' }),
    comments: (postId) => request(`/posts/${postId}/comments`),
    addComment: (postId, bodyText, parentId) =>
      request(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body: bodyText, parent_id: parentId || null }) }),
    removeComment: (commentId) => request(`/posts/comments/${commentId}`, { method: 'DELETE' }),
  },
  messages: {
    conversations: () => request('/messages/conversations'),
    openDirect: (userId) => request(`/messages/conversations/direct/${userId}`, { method: 'POST' }),
    history: (conversationId, before) =>
      request(`/messages/conversations/${conversationId}/messages${before ? `?before=${before}` : ''}`),
    send: (conversationId, bodyText, file, replyToId) => {
      if (file) {
        const formData = new FormData();
        if (bodyText) formData.append('body', bodyText);
        formData.append('media', file);
        if (replyToId) formData.append('reply_to_id', String(replyToId));
        return request(`/messages/conversations/${conversationId}/messages`, { method: 'POST', body: formData });
      }
      return request(`/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: bodyText, reply_to_id: replyToId || null }),
      });
    },
    markRead: (conversationId) => request(`/messages/conversations/${conversationId}/read`, { method: 'PATCH' }),
  },
  linkedAccounts: {
    mine: () => request('/linked-accounts'),
    forUser: (username) => request(`/linked-accounts/user/${encodeURIComponent(username)}`),
    set: (platform, body) => request(`/linked-accounts/${platform}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (platform) => request(`/linked-accounts/${platform}`, { method: 'DELETE' }),
    ping: (platform, message) =>
      request('/linked-accounts/ping', { method: 'POST', body: JSON.stringify({ platform, message }) }),
  },
  notifications: {
    list: (before) => request(`/notifications${before ? `?before=${before}` : ''}`),
    unreadCount: () => request('/notifications/unread-count'),
    readAll: () => request('/notifications/read-all', { method: 'POST' }),
    read: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  },
  calls: {
    history: () => request('/calls'),
  },
};
