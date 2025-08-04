import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './UserManagement.css';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  
  // Form states
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    role: 'inspector'
  });
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
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
      // Check if employee exists
      const { data: existingEmployee } = await supabase
        .from('employees')
        .select('id')
        .eq('email', newUser.email.toLowerCase())
        .single();

      if (!existingEmployee) {
        setError('Employee record not found. Please create employee record first.');
        return;
      }

      // Create auth user using regular signUp
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: newUser.email,
        password: newUser.password
      });

      if (authError) throw authError;

      // Update employee role and has_account flag
      const { error: updateError } = await supabase
        .from('employees')
        .update({ 
          role: newUser.role,
          has_account: true 
        })
        .eq('email', newUser.email.toLowerCase());

      if (updateError) throw updateError;

      setSuccessMessage('User created successfully. They should check their email to confirm.');
      setShowCreateModal(false);
      setNewUser({ email: '', password: '', confirmPassword: '', role: 'inspector' });
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
      case 'admin': return 'badge-admin';
      case 'manager': return 'badge-manager';
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

      {error && (
        <div className="um-error">{error}</div>
      )}

      {successMessage && (
        <div className="um-success">{successMessage}</div>
      )}

      <div className="um-instructions">
        <p><strong>Instructions:</strong></p>
        <ul>
          <li>Only employees already in the system can have user accounts created</li>
          <li>Admins have full access to all features including billing and payroll</li>
          <li>Managers cannot access billing and payroll modules</li>
          <li>Inspectors have limited access to their assigned jobs only</li>
        </ul>
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
                <th>Role</th>
                <th>Inspector Type</th>
                <th>Status</th>
                <th>Has Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.first_name} {user.last_name}</td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      value={user.role || 'inspector'}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className={`role-select ${getRoleBadgeClass(user.role)}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="inspector">Inspector</option>
                    </select>
                  </td>
                  <td>{user.inspector_type || '-'}</td>
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
                  <td>
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
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="inspector">Inspector</option>
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
