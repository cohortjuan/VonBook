// shared with pages/Notifications.jsx (in-app list) and components/Layout.jsx
// (native OS notification body) so both describe a notification the same way.
export const NOTIFICATION_LABEL = {
  friend_request: () => `sent you a friend request`,
  friend_accept: () => `accepted your friend request`,
  like: () => `liked your post`,
  comment: () => `commented on your post`,
  message: () => `sent you a message`,
  missed_call: () => `you missed a call`,
  platform_ping: (n) => `posted something new on ${n.payload?.platform || 'another app'}${n.payload?.message ? `: "${n.payload.message}"` : ''}`,
  report: (n) => `reported a post${n.payload?.authorUsername ? ` by @${n.payload.authorUsername}` : ''}`,
  mention: () => `tagged you`,
};
