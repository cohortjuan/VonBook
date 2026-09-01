// wraps a user's name in the founder's signature gradient + a little
// sparkle when it's him, plain text otherwise
export default function DisplayName({ user, className = '' }) {
  if (!user) return null;
  if (user.is_founder) {
    return <span className={`founder-name ${className}`}>{user.display_name} ✨</span>;
  }
  return <span className={className}>{user.display_name}</span>;
}
