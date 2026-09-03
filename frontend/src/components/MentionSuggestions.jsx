import Avatar from './Avatar.jsx';

// onMouseDown (not onClick) with preventDefault so picking a suggestion
// never blurs the input first -- a plain onClick would fire after the
// input's own onBlur already closed this dropdown, since mousedown comes
// before the click's corresponding focus change.
export default function MentionSuggestions({ suggestions, onSelect }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mention-suggestions">
      {suggestions.map((u) => (
        <button
          key={u.id}
          type="button"
          className="mention-suggestion"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(u.username);
          }}
        >
          <Avatar user={u} size={24} />
          <span className="mention-suggestion-name">{u.display_name}</span>
          <span className="mention-suggestion-handle">@{u.username}</span>
        </button>
      ))}
    </div>
  );
}
