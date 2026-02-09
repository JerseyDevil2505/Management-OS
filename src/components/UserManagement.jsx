import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './UserManagement.css';

const UserManagement = ({ onViewAs }) => {
  const [users, setUsers] = useState([]);
  const [organizations, setOrganizations] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [filterOrg, setFilterOrg] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  
  // Form states
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    role: 'Management'
  });
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');

  useEffect(() => {
    loadUsers();
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      const { data } = await supabase
        .from('organizations')
        .select('id, name, org_type')
        .order('name');
      const orgMap = {};
      (data || []).forEach(org => { orgMap[org.id] = org; });
      setOrganizations(orgMap);
    } catch (err) {
      console.error('Error loading organizations:', err);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('employment_status', 'full_time')
        .in('role', ['Management', 'Admin', 'Owner'])
        .order('last_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const PPA_ORG_ID = '00000000-0000-0000-0000-000000000001';
  const isDevMode = process.env.NODE_ENV === 'development';

  const getOrgName = (orgId) => {
    if (!orgId) return 'PPA Inc (Internal)';
    const org = organizations[orgId];
    if (!org) return orgId === PPA_ORG_ID ? 'PPA (Internal)' : 'Unknown';
    return org.org_type === 'internal' ? `${org.name} (Internal)` : org.name;
  };

  const isAssessorUser = (user) => {
    return user.organization_id && user.organization_id !== PPA_ORG_ID;
  };

  const filteredUsers = filterOrg === 'all'
    ? users
    : filterOrg === 'ppa'
      ? users.filter(u => !u.organization_id || u.organization_id === PPA_ORG_ID)
      : users.filter(u => u.organization_id === filterOrg);

  const uniqueOrgIds = [...new Set(users.map(u => u.organization_id).filter(Boolean))];

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (newUser.password !== newUser.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newUser.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      // Just trim the email, don't force lowercase - keep it exactly as entered
      const emailToSearch = newUser.email.trim();
      
      // Check if employee exists using case-insensitive search
      const { data: existingEmployee } = await supabase
        .from('employees')
        .select('*')
        .ilike('email', emailToSearch)  // Use ilike for case-insensitive search
        .single();

      if (!existingEmployee) {
        setError('Employee record not found. Please create employee record first.');
        return;
      }

      // Create auth user with metadata for profiles table
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: emailToSearch,  // Use the email as entered
        password: newUser.password,
        options: {
          data: {
            full_name: `${existingEmployee.first_name} ${existingEmployee.last_name}`
          }
        }
      });

      if (authError) throw authError;

      // Update employee role and has_account flag using the ID (more reliable than email)
      const { error: updateError } = await supabase
        .from('employees')
        .update({ 
          role: newUser.role,
          has_account: true 
        })
        .eq('id', existingEmployee.id);  // Use ID instead of email for update

      if (updateError) throw updateError;

      setSuccessMessage('User created successfully. They should check their email to confirm.');
      setShowCreateModal(false);
      setNewUser({ email: '', password: '', confirmPassword: '', role: 'Management' });
      loadUsers();
    } catch (err) {
      console.error('Error creating user:', err);
      setError(err.message || 'Failed to create user');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    try {
      // Send password reset email
      const { error } = await supabase.auth.resetPasswordForEmail(selectedUser.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setSuccessMessage(`Password reset email sent to ${selectedUser.email}`);
      setShowResetModal(false);
      setResetPassword('');
      setConfirmResetPassword('');
      setSelectedUser(null);
    } catch (err) {
      console.error('Error resetting password:', err);
      setError(err.message || 'Failed to send reset email');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      setSuccessMessage('Role updated successfully');
      loadUsers();
    } catch (err) {
      console.error('Error updating role:', err);
      setError('Failed to update role');
    }
  };

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case 'Owner': return 'badge-owner';
      case 'Admin': return 'badge-admin';
      case 'Management': return 'badge-manager';
      default: return 'badge-inspector';
    }
  };

  return (
    <div className="user-management-container">
      <div className="um-header">
        <h2>User Account Management</h2>
        <button 
          className="create-user-btn"
          onClick={() => setShowCreateModal(true)}
        >
          Create User Account
        </button>
      </div>

      {/* Access Control Summary */}
      <div className="access-control-summary">
        <h3>Tab Access Control</h3>
        <div className="access-grid">
          <div className="access-item">
            <span className="access-tab">👥 Employees</span>
            <span className="access-roles all-roles">All Users</span>
          </div>
          <div className="access-item">
            <span className="access-tab">📋 Jobs</span>
            <span className="access-roles all-roles">All Users</span>
          </div>
          <div className="access-item">
            <span className="access-tab">⚖️ Appeal Coverage</span>
            <span className="access-roles all-roles">All Users</span>
          </div>
          <div className="access-item">
            <span className="access-tab">💰 Billing</span>
            <span className="access-roles admin-only">Admin + Owner</span>
          </div>
          <div className="access-item">
            <span className="access-tab">💸 Payroll</span>
            <span className="access-roles admin-only">Admin + Owner</span>
          </div>
          <div className="access-item">
            <span className="access-tab">🔐 Users</span>
            <span className="access-roles owner-only">Primary Owner Only</span>
          </div>
          <div className="access-item">
            <span className="access-tab">🏢 Organizations</span>
            <span className="access-roles owner-only">Primary Owner Only</span>
          </div>
          <div className="access-item">
            <span className="access-tab">💵 Revenue</span>
            <span className="access-roles owner-only">Primary Owner Only</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="um-error">{error}</div>
      )}

      {successMessage && (
        <div className="um-success">{successMessage}</div>
      )}

      {/* Filter Bar */}
      <div className="um-filter-bar" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: '500', color: '#374151' }}>Filter:</label>
        <select
          value={filterOrg}
          onChange={(e) => setFilterOrg(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.875rem' }}
        >
          <option value="all">All Users ({users.length})</option>
          <option value="ppa">PPA Inc</option>
          {uniqueOrgIds.filter(id => id !== PPA_ORG_ID).map(orgId => (
            <option key={orgId} value={orgId}>{getOrgName(orgId)}</option>
          ))}
        </select>
        <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
          Showing {filteredUsers.length} of {users.length} users
        </span>
      </div>

      {loading ? (
        <div className="um-loading">Loading users...</div>
      ) : (
        <div className="um-table-container">
          <table className="um-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Organization</th>
                <th>Role</th>
                <th>Status</th>
                <th>Has Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => (
                <tr key={user.id}>
                  <td>{user.first_name} {user.last_name}</td>
                  <td>{user.email}</td>
                  <td>
                    <span style={{
                      padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600',
                      background: isAssessorUser(user) ? '#dbeafe' : '#f3f4f6',
                      color: isAssessorUser(user) ? '#1e40af' : '#6b7280'
                    }}>
                      {getOrgName(user.organization_id)}
                    </span>
                  </td>
                  <td>
                    <select
                      value={user.role || 'Management'}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className={`role-select ${getRoleBadgeClass(user.role)}`}
                    >
                      <option value="Owner">Owner</option>
                      <option value="Admin">Admin</option>
                      <option value="Management">Management</option>
                    </select>
                  </td>
                  <td>
                    <span className={`status-badge ${user.employment_status === 'Inactive' ? 'inactive' : 'active'}`}>
                      {user.employment_status || 'Active'}
                    </span>
                  </td>
                  <td>
                    <span className={`account-badge ${user.has_account ? 'has-account' : 'no-account'}`}>
                      {user.has_account ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      className="reset-pwd-btn"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowResetModal(true);
                      }}
                      disabled={!user.has_account}
                    >
                      Reset Password
                    </button>
                    {isDevMode && isAssessorUser(user) && onViewAs && (
                      <button
                        onClick={() => onViewAs(user)}
                        style={{
                          padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                          background: '#7c3aed', color: 'white', border: 'none', cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                        title={`View dashboard as ${user.first_name} ${user.last_name}`}
                      >
                        View As
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="um-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="um-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create User Account</h3>
            <form onSubmit={handleCreateUser}>
              <div className="um-form-group">
                <label>Employee Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  placeholder="Select from existing employees"
                  required
                />
              </div>
              
              <div className="um-form-group">
                <label>Initial Password</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                  placeholder="Minimum 6 characters"
                  required
                />
              </div>

              <div className="um-form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={newUser.confirmPassword}
                  onChange={(e) => setNewUser({...newUser, confirmPassword: e.target.value})}
                  placeholder="Confirm password"
                  required
                />
              </div>

              <div className="um-form-group">
                <label>Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                >
                  <option value="Owner">Owner</option>
                  <option value="Admin">Admin</option>
                  <option value="Management">Management</option>
                </select>
              </div>

              <div className="um-modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="um-modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="um-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reset Password for {selectedUser.first_name} {selectedUser.last_name}</h3>
            <p className="reset-info">
              A password reset email will be sent to {selectedUser.email}
            </p>
            <form onSubmit={handleResetPassword}>
              <div className="um-modal-actions">
                <button type="button" onClick={() => setShowResetModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Send Reset Email
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
