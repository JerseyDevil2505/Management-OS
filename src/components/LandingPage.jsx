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
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) throw authError;

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (empError || !employee) {
        throw new Error('Employee record not found. Please contact your administrator.');
      }

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
              Comprehensive tools to help guide you through mass appraisal
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

          {/* Platform Capabilities */}
          <section className="features-section">
            <h3 className="features-heading">Platform Capabilities</h3>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/7578856/pexels-photo-7578856.jpeg" alt="Comparable Sales Analysis" />
                </div>
                <h4>Sales Comparison (CME)</h4>
                <p>Evaluate every property using the sales comparison approach with ranked comparables, adjustable brackets, and projected assessments</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/7937208/pexels-photo-7937208.jpeg" alt="Market Analysis" />
                </div>
                <h4>Market Analysis</h4>
                <p>Data quality validation, time and size normalization, block-level consistency metrics, and overall analysis reporting</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/29356756/pexels-photo-29356756.jpeg" alt="Land Valuation" />
                </div>
                <h4>Land Valuation</h4>
                <p>Vacant sales analysis, cascade rate configuration, allocation studies, depth tables, and site value calculations by VCS</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/97080/pexels-photo-97080.jpeg" alt="Production Tracking" />
                </div>
                <h4>Production Tracking</h4>
                <p>Real-time inspection analytics, inspector performance metrics, validation reporting, and workflow management</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/8293774/pexels-photo-8293774.jpeg" alt="Job Lifecycle" />
                </div>
                <h4>Job Lifecycle Management</h4>
                <p>From job creation through data processing, file comparisons, and a 29-item management checklist to keep everything on track</p>
              </div>
              <div className="feature-card">
                <div className="feature-image">
                  <img src="https://images.pexels.com/photos/7821564/pexels-photo-7821564.jpeg" alt="Appeal Coverage" />
                </div>
                <h4>Appeal Defense</h4>
                <p>Complete audit trails, Chapter 123 analysis, detailed appraisal grids, and exportable PDF reports for litigation support</p>
              </div>
            </div>
          </section>

          {/* About Me Section */}
          <section className="about-section">
            <div className="about-content">
              <div className="about-text">
                <h3>About <span className="about-accent">Me</span></h3>
                <p>
                  The LOJIK Evaluator has been used in multiple Revaluation and Reassessment
                  projects in the State of New Jersey, producing accurate assessments that ensure
                  equitable distribution of the tax levy.
                </p>
                <p>
                  Real estate valuation is as much an art as it is scientific or mathematical.
                  This platform transforms decades of hands-on appraisal methodology into a
                  documented, repeatable process — handling the entire lifecycle from job creation
                  and data processing through market analysis, final valuation, and appeal defense.
                </p>
                <p>
                  Built to scale from a single municipality to enterprise-level operations
                  processing 50,000+ property records, the Property Assessment Copilot replaces
                  spreadsheet-based workflows with database-driven intelligence while preserving
                  the professional judgment that defines quality mass appraisal.
                </p>
              </div>
              <div className="about-stats">
                <div className="stat-item">
                  <div className="stat-value">50K+</div>
                  <div className="stat-label">Properties Processed</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">NJ</div>
                  <div className="stat-label">Statewide Coverage</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">2</div>
                  <div className="stat-label">Approaches to Value</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="landing-footer">
        <p>&copy; 2025 LOJIK. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
