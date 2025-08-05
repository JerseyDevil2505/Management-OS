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

  // Logo SVG component
  const LogoSVG = () => (
    <svg width="50" height="50" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="473.333" y="366.667" width="266.667" height="266.667" transform="rotate(-15 473.333 366.667)" fill="#52B5E8" stroke="#52B5E8" strokeWidth="60"/>
      <rect x="133.333" y="266.667" width="266.667" height="266.667" transform="rotate(-45 133.333 266.667)" fill="#52B5E8" stroke="#52B5E8" strokeWidth="60"/>
    </svg>
  );

  return (
    <div className="landing-container">
      <header className="landing-header">
        <div className="header-content">
          <div className="logo-title-group">
            <LogoSVG />
            <div className="title-group">
              <h1>LOJIK</h1>
              <p className="tagline">For<br />Professional Property Appraisers</p>
            </div>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <div className="content-wrapper">
          <section className="hero-section">
            <h2>Management Operating System</h2>
            <p className="hero-description">
              Streamline your property appraisal workflow with our comprehensive management platform
            </p>
          </section>

          <div className="login-card">
            <h3>Sign In</h3>
            <div>
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
                  onKeyPress={(e) => e.key === 'Enter' && password && handleLogin(e)}
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
                  onKeyPress={(e) => e.key === 'Enter' && email && handleLogin(e)}
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button 
                className="login-button" 
                disabled={loading || !email || !password}
                onClick={handleLogin}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>

            <div className="login-footer">
              <p>Need help? Contact your system administrator</p>
            </div>
          </div>

          <section className="features-section">
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon">📋</div>
                <h4>Job Management</h4>
                <p>Track and manage property assessment jobs from creation to completion</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">📊</div>
                <h4>Production Tracking</h4>
                <p>Real-time analytics and validation for inspection data</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🔄</div>
                <h4>Workflow Automation</h4>
                <p>Streamlined processes with automated checklist management</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">💰</div>
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
