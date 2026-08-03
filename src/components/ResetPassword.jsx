import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './LandingPage.css';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setSuccess(true);
      // Drop the recovery session so the new password is used on the next sign-in.
      await supabase.auth.signOut();
      setTimeout(() => window.location.replace(window.location.origin), 2500);
    } catch (err) {
      setError(err.message || 'Could not update password. The link may have expired.');
      setLoading(false);
    }
  };

  return (
    <div className="landing-container">
      <main className="landing-main">
        <div className="content-wrapper">
          <div className="login-card">
            <h3>Choose a New Password</h3>

            {success ? (
              <div className="reset-sent-message">
                Password updated. Taking you back to sign in...
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="new-password">New Password</label>
                  <input
                    type="password"
                    id="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirm-password">Confirm New Password</label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    required
                    disabled={loading}
                  />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="login-button" disabled={loading}>
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )}

            <div className="login-footer">
              <p>Need help? Contact your system administrator</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ResetPassword;
