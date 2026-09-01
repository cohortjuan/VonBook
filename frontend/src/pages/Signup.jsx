import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', display_name: '', password: '', birthday: '', founder_code: '' });
  const [showFounderField, setShowFounderField] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signup(form);
      navigate('/', { replace: true });
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
        <p className="auth-tagline">Make your profile. Add your people.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Display name
            <input value={form.display_name} onChange={update('display_name')} required />
          </label>
          <label>
            Username
            <input value={form.username} onChange={update('username')} placeholder="letters, numbers, _" required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={update('password')}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Birthday (optional)
            <input type="date" value={form.birthday} onChange={update('birthday')} />
          </label>

          {showFounderField ? (
            <label>
              Founder code
              <input value={form.founder_code} onChange={update('founder_code')} placeholder="only if you were given one" />
            </label>
          ) : (
            <button type="button" className="btn-link" onClick={() => setShowFounderField(true)}>
              I have a founder code
            </button>
          )}

          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
