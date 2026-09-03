import { useState } from 'react';
import { dismissPublicWarning } from '../lib/publicPostWarning.js';

// shown the first time someone flips a post public, either from CreatePost
// or from the toggle on an existing post in PostCard -- both pass the same
// onConfirm/onCancel shape, see publicWarningDismissed() for the skip check.
export default function PublicPostWarning({ onConfirm, onCancel }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function confirm() {
    if (dontShowAgain) dismissPublicWarning();
    onConfirm();
  }

  return (
    <div className="public-warning-backdrop">
      <div className="public-warning-modal">
        <h3>Make this post public?</h3>
        <p>Everyone on VonBook will be able to see this in their feed, not just your friends -- anyone can like or comment on it too.</p>
        <label className="public-warning-checkbox">
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don't show this again
        </label>
        <div className="public-warning-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={confirm}>
            Make Public
          </button>
        </div>
      </div>
    </div>
  );
}
