import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './LandingPage.css';

const LandingPage = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Authenticate with Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;

      // Get employee record to check role
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (empError || !employee) {
        throw new Error('Employee record not found. Please contact your administrator.');
      }

      // Pass user data to parent component
      onLogin({
        ...authData.user,
        role: employee.role,
        employeeData: employee
      });

    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Logo component using provided image
  const LogoImage = () => (
    <img
      src="https://cdn.builder.io/api/v1/image/assets%2F3a0ecd403c3d43a899b6b2065bb803d7%2F0bb052847abd4179b00037bd7055ded4?format=webp&width=800"
      alt="LOJIK Logo"
      className="company-logo"
    />
  );

  return (
    <div className="landing-container">
      <header className="landing-header">
        <div className="header-content">
          <div className="logo-title-group">
            <LogoImage />
            <div className="title-group">
              <p className="tagline">For<br />Professional Property Appraisers</p>
            </div>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <div className="content-wrapper">
          <section className="hero-section">
            <h2>Property Assessment Copilot</h2>
            <p className="hero-description">
              Your AI-powered partner for property valuation, market analysis, and assessment management
            </p>
          </section>

          <div className="login-card">
            <h3>Sign In</h3>
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={loading}
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button type="submit" className="login-button" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="login-footer">
              <p>Need help? Contact your system administrator</p>
              <button
                type="button"
                onClick={() => onLogin({
                  email: 'dev@lojik.com',
                  role: 'admin',
                  employeeData: {
                    name: 'Development Mode',
                    role: 'admin'
                  }
                })}
                className="dev-bypass-button"
              >
                Development Access
              </button>
            </div>
          </div>

          <section className="features-section">
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/7693194/pexels-photo-7693194.jpeg" alt="Job Management" />
                </div>
                <h4>Job Management</h4>
                <p>Track and manage property assessment jobs from creation to completion</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/7793173/pexels-photo-7793173.jpeg" alt="Production Tracking" />
                </div>
                <h4>Production Tracking</h4>
                <p>Real-time analytics and validation for inspection data</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/8867475/pexels-photo-8867475.jpeg" alt="Workflow Automation" />
                </div>
                <h4>Workflow Automation</h4>
                <p>Streamlined processes with automated checklist management</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/16282318/pexels-photo-16282318.jpeg" alt="Financial Operations" />
                </div>
                <h4>Financial Operations</h4>
                <p>Comprehensive billing and payroll management</p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="landing-footer">
        <p>&copy; 2025 LOJIK for Professional Property Appraisers Inc. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
