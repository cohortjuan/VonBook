import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// an "@" that starts a mention has to be at the very start of the text or
// right after whitespace (so "email me at test@example" doesn't trigger
// off the @ in the middle of that word) -- capturing that lead character
// separately so it can be preserved exactly (space, tab, newline, or
// nothing) when the completed @username gets spliced back in.
const TOKEN_RE = /(^|\s)@([a-zA-Z0-9_]{0,20})$/;

// detects an "@partial" token immediately before the cursor in a
// controlled textarea/input and offers matching usernames to complete
// it. reads the dom node's live .value directly (via inputRef) rather
// than taking a value prop, since react's own controlled state hasn't
// caught up yet at the exact moment a keystroke's change handler runs --
// call checkToken() from onChange/onKeyUp/onClick so cursor moves from
// any of those get picked up.
export function useMentionAutocomplete(inputRef, setValue) {
  const [query, setQuery] = useState(null); // null = no active @token right now
  const [suggestions, setSuggestions] = useState([]);

  function checkToken() {
    const el = inputRef.current;
    if (!el) return;
    const upToCursor = el.value.slice(0, el.selectionStart);
    const match = TOKEN_RE.exec(upToCursor);
    setQuery(match ? match[2] : null);
  }

  function dismiss() {
    setQuery(null);
  }

  useEffect(() => {
    if (query === null || query.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api.users
      .search(query)
      .then((rows) => {
        if (!cancelled) setSuggestions(rows.slice(0, 5));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [query]);

  function selectSuggestion(username) {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const upToCursor = el.value.slice(0, cursor);
    const afterCursor = el.value.slice(cursor);
    const replaced = upToCursor.replace(TOKEN_RE, (_whole, lead) => `${lead}@${username} `);
    const nextValue = replaced + afterCursor;
    setValue(nextValue);
    setQuery(null);
    // restore focus + cursor right after the inserted username -- react
    // hasn't re-rendered the new value into the dom yet this tick, so
    // this has to wait a frame or setSelectionRange would clamp against
    // the still-stale (shorter) value currently in the element.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(replaced.length, replaced.length);
    });
  }

  return {
    suggestions: query !== null && query.length >= 2 ? suggestions : [],
    checkToken,
    dismiss,
    selectSuggestion,
  };
}
