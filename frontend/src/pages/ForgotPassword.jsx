import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // backend always responds the same way whether or not the email has
      // an account -- see auth.js's forgot-password handler
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="brand-wordmark">VonBook</h1>
        {sent ? (
          <>
            <p className="auth-tagline">
              If <strong>{email}</strong> has an account, a reset link is on its way -- it's good for 1 hour.
            </p>
            <p className="auth-switch">
              <Link to="/login">Back to login</Link>
            </p>
          </>
        ) : (
          <>
            <p className="auth-tagline">Enter your email and we'll send you a reset link.</p>
            <form onSubmit={handleSubmit} className="auth-form">
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="auth-switch">
              <Link to="/login">Back to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
