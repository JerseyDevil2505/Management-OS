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
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'Admin',
    organizationId: ''
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
    if (!org) return orgId === PPA_ORG_ID ? 'PPA Inc (Internal)' : 'Unknown';
    return org.org_type === 'internal' ? 'PPA Inc (Internal)' : org.name;
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

  const orgList = Object.values(organizations).sort((a, b) => {
    // Internal orgs first, then alphabetical
    if (a.org_type === 'internal' && b.org_type !== 'internal') return -1;
    if (a.org_type !== 'internal' && b.org_type === 'internal') return 1;
    return a.name.localeCompare(b.name);
  });

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!newUser.firstName.trim() || !newUser.lastName.trim()) {
      setError('First name and last name are required');
      return;
    }

    if (newUser.password !== newUser.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newUser.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      const emailTrimmed = newUser.email.trim();
      const fullName = `${newUser.firstName.trim()} ${newUser.lastName.trim()}`;
      const selectedOrgId = newUser.organizationId || null;

      // Get current auth user for created_by
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id;

      // Check if employee already exists
      const { data: existingEmployee } = await supabase
        .from('employees')
        .select('*')
        .ilike('email', emailTrimmed)
        .single();

      let employeeId;

      if (existingEmployee) {
        // Employee exists - update it
        employeeId = existingEmployee.id;
        const { error: updateError } = await supabase
          .from('employees')
          .update({
            first_name: newUser.firstName.trim(),
            last_name: newUser.lastName.trim(),
            role: newUser.role,
            organization_id: selectedOrgId,
            has_account: true
          })
          .eq('id', existingEmployee.id);
        if (updateError) throw updateError;
      } else {
        // Create new employee record
        const empNumber = selectedOrgId && selectedOrgId !== PPA_ORG_ID
          ? `ORG-${Date.now().toString(36).toUpperCase()}`
          : `EMP-${Date.now().toString(36).toUpperCase()}`;

        const initials = `${newUser.firstName.charAt(0)}${newUser.lastName.charAt(0)}`.toUpperCase();

        const { data: newEmp, error: empError } = await supabase
          .from('employees')
          .insert({
            first_name: newUser.firstName.trim(),
            last_name: newUser.lastName.trim(),
            email: emailTrimmed,
            employee_number: empNumber,
            initials: initials,
            role: newUser.role,
            organization_id: selectedOrgId,
            employment_status: 'full_time',
            has_account: true,
            created_by: currentUserId
          })
          .select()
          .single();
        if (empError) throw empError;
        employeeId = newEmp.id;
      }

      // Create Supabase auth account
      const { error: authError } = await supabase.auth.signUp({
        email: emailTrimmed,
        password: newUser.password,
        options: {
          data: { full_name: fullName }
        }
      });
      if (authError) throw authError;

      setSuccessMessage(`Account created for ${fullName}. They should check their email to confirm.`);
      setShowCreateModal(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', role: 'Admin', organizationId: '' });
      loadUsers();
    } catch (err) {
      console.error('Error creating user:', err);
      const msg = err?.message || err?.error_description || err?.details || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      setError(msg || 'Failed to create user');
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
                    {isAssessorUser(user) ? (
                      <span style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600',
                        background: '#dbeafe', color: '#1e40af'
                      }}>
                        Client User
                      </span>
                    ) : (
                      <select
                        value={user.role || 'Management'}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className={`role-select ${getRoleBadgeClass(user.role)}`}
                      >
                        <option value="Owner">Owner</option>
                        <option value="Admin">Admin</option>
                        <option value="Management">Management</option>
                      </select>
                    )}
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
                <label>Organization</label>
                <select
                  value={newUser.organizationId}
                  onChange={(e) => {
                    const orgId = e.target.value;
                    const isExternal = orgId && orgId !== PPA_ORG_ID && organizations[orgId]?.org_type !== 'internal';
                    setNewUser({...newUser, organizationId: orgId, role: isExternal ? 'Admin' : newUser.role});
                  }}
                >
                  <option value="">-- Select Organization --</option>
                  {orgList.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.org_type === 'internal' ? 'PPA Inc' : org.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label>First Name *</label>
                  <input
                    type="text"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({...newUser, firstName: e.target.value})}
                    placeholder="First name"
                    required
                  />
                </div>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label>Last Name *</label>
                  <input
                    type="text"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({...newUser, lastName: e.target.value})}
                    placeholder="Last name"
                    required
                  />
                </div>
              </div>

              <div className="um-form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                  placeholder="user@example.com"
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label>Password *</label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    placeholder="Min 6 characters"
                    required
                  />
                </div>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label>Confirm Password *</label>
                  <input
                    type="password"
                    value={newUser.confirmPassword}
                    onChange={(e) => setNewUser({...newUser, confirmPassword: e.target.value})}
                    placeholder="Confirm password"
                    required
                  />
                </div>
              </div>

              {(!newUser.organizationId || newUser.organizationId === PPA_ORG_ID || (organizations[newUser.organizationId]?.org_type === 'internal')) && (
                <div className="um-form-group">
                  <label>Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                  >
                    <option value="Admin">Admin</option>
                    <option value="Management">Management</option>
                    <option value="Owner">Owner</option>
                  </select>
                </div>
              )}

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
