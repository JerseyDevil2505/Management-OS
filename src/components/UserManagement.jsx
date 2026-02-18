import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './UserManagement.css';

const UserManagement = ({ onViewAs }) => {
  const [users, setUsers] = useState([]);
  const [organizations, setOrganizations] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [employeeOrgLinks, setEmployeeOrgLinks] = useState({});
  
  // Form states
  const [newUser, setNewUser] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'Admin',
    organizationId: '',
    selectedOrgIds: []
  });
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    loadUsers();
    loadOrganizations();
    loadEmployeeOrgLinks();
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

  const loadEmployeeOrgLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_organizations')
        .select('employee_id, organization_id, is_primary');
      if (error) throw error;
      const linkMap = {};
      (data || []).forEach(link => {
        if (!linkMap[link.employee_id]) linkMap[link.employee_id] = [];
        linkMap[link.employee_id].push(link);
      });
      setEmployeeOrgLinks(linkMap);
    } catch (err) {
      console.error('Error loading employee org links:', err);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('employment_status', 'full_time')
        .in('role', ['Management', 'Admin', 'Owner', 'client_user'])
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

  // Split users into PPA and LOJIK groups
  const ppaUsers = users.filter(u => !u.organization_id || u.organization_id === PPA_ORG_ID);
  const lojikUsers = users.filter(u => u.organization_id && u.organization_id !== PPA_ORG_ID);

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

    // For LOJIK clients, require at least one org selected
    const lojikOrgIds = newUser.selectedOrgIds.filter(id => id !== PPA_ORG_ID);
    const isPpaUser = newUser.organizationId === PPA_ORG_ID;

    if (!isPpaUser && lojikOrgIds.length === 0 && !newUser.organizationId) {
      setError('Please select at least one organization');
      return;
    }

    try {
      const emailTrimmed = newUser.email.trim();
      const fullName = `${newUser.firstName.trim()} ${newUser.lastName.trim()}`;
      // Primary org: for PPA users use PPA, for LOJIK use first selected org
      const selectedOrgId = isPpaUser ? PPA_ORG_ID : (lojikOrgIds[0] || newUser.organizationId);

      // Get current auth user for created_by
      const { data: { session } } = await supabase.auth.getSession();
      // In dev mode, fall back to the PPA admin user ID
      const currentUserId = session?.user?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad';

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
          data: {
            full_name: fullName,
            organization_id: selectedOrgId
          }
        }
      });
      if (authError) throw authError;

      // Store the initial password on the employee record for admin reference
      await supabase
        .from('employees')
        .update({ initial_password: newUser.password })
        .eq('id', employeeId);

      // Save all organization links in junction table
      const orgIdsToLink = isPpaUser ? [] : lojikOrgIds;
      if (orgIdsToLink.length > 0) {
        // Remove existing links for this employee
        await supabase
          .from('employee_organizations')
          .delete()
          .eq('employee_id', employeeId);

        // Insert all org links
        const orgLinks = orgIdsToLink.map((orgId, idx) => ({
          employee_id: employeeId,
          organization_id: orgId,
          is_primary: orgId === selectedOrgId
        }));
        const { error: linkError } = await supabase
          .from('employee_organizations')
          .insert(orgLinks);
        if (linkError) console.error('Error linking orgs:', linkError);
      }

      setSuccessMessage(`Account created for ${fullName}. They should check their email to confirm.`);
      loadEmployeeOrgLinks();
      setShowCreateModal(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', role: 'Admin', organizationId: '', selectedOrgIds: [] });
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

    if (!resetPassword.trim()) {
      setError('Please enter a new password');
      return;
    }
    if (resetPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      // Call edge function to update auth password
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/update-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || process.env.REACT_APP_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email: selectedUser.email, password: resetPassword }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update password');

      // Store the new password on the employee record
      await supabase
        .from('employees')
        .update({ initial_password: resetPassword })
        .eq('id', selectedUser.id);

      setSuccessMessage(`Password updated for ${selectedUser.first_name} ${selectedUser.last_name}`);
      setShowResetModal(false);
      setResetPassword('');
      setSelectedUser(null);
      loadUsers();
    } catch (err) {
      console.error('Error resetting password:', err);
      setError(err.message || 'Failed to reset password');
    }
  };

  const handleDeleteUser = async (user) => {
    setError('');
    setSuccessMessage('');
    try {
      // Delete from profiles table (linked to auth.users)
      if (user.email) {
        // Find the auth user's profile by email and delete it
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', user.email)
          .single();
        if (profile) {
          await supabase.from('profiles').delete().eq('id', profile.id);
        }
      }

      // Delete the employee record
      const { error: delError } = await supabase
        .from('employees')
        .delete()
        .eq('id', user.id);
      if (delError) throw delError;

      setSuccessMessage(`Deleted ${user.first_name} ${user.last_name}`);
      setShowDeleteConfirm(null);
      loadUsers();
    } catch (err) {
      console.error('Error deleting user:', err);
      const msg = err?.message || err?.error_description || err?.details || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      setError(msg || 'Failed to delete user');
      setShowDeleteConfirm(null);
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

      {error && (
        <div className="um-error">{error}</div>
      )}

      {successMessage && (
        <div className="um-success">{successMessage}</div>
      )}

      {loading ? (
        <div className="um-loading">Loading users...</div>
      ) : (
        <>
          {/* PPA Users Table */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e3a5f', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              PPA Inc Users
              <span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '12px' }}>
                {ppaUsers.length}
              </span>
            </h3>
            <div className="um-table-container">
              <table className="um-table">
                <colgroup>
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '25%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Account</th>
                    <th>Password</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ppaUsers.map(user => (
                    <tr key={user.id}>
                      <td>{user.first_name} {user.last_name}</td>
                      <td>{user.email}</td>
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
                      <td>
                        {user.initial_password ? (
                          <code style={{
                            padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem',
                            background: '#f3f4f6', color: '#374151', fontFamily: 'monospace'
                          }}>
                            {user.initial_password}
                          </code>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>--</span>
                        )}
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
                        {showDeleteConfirm === user.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteUser(user)}
                              style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                                background: '#dc2626', color: 'white', border: 'none', cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(null)}
                              style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                                background: '#e5e7eb', color: '#374151', border: 'none', cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setShowDeleteConfirm(user.id)}
                            style={{
                              padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                              background: '#fee2e2', color: '#dc2626', border: 'none', cursor: 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* LOJIK Clients Table */}
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e40af', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              LOJIK Clients
              <span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#1e40af', background: '#dbeafe', padding: '2px 8px', borderRadius: '12px' }}>
                {lojikUsers.length}
              </span>
            </h3>
            {lojikUsers.length === 0 ? (
              <div style={{ padding: '24px', background: '#f9fafb', borderRadius: '8px', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                No LOJIK client users yet. Create one using the button above.
              </div>
            ) : (
              <div className="um-table-container">
                <table className="um-table">
                  <colgroup>
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '25%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Organization</th>
                      <th>Status</th>
                      <th>Account</th>
                      <th>Password</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lojikUsers.map(user => (
                      <tr key={user.id}>
                        <td>{user.first_name} {user.last_name}</td>
                        <td>{user.email}</td>
                        <td>
                          {(() => {
                            const links = employeeOrgLinks[user.id] || [];
                            const orgIds = links.length > 0
                              ? links.map(l => l.organization_id)
                              : (user.organization_id ? [user.organization_id] : []);
                            return orgIds.map(orgId => (
                              <span key={orgId} style={{
                                display: 'inline-block',
                                padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600',
                                background: '#dbeafe', color: '#1e40af',
                                margin: '1px 2px'
                              }}>
                                {getOrgName(orgId)}
                              </span>
                            ));
                          })()}
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
                        <td>
                          {user.initial_password ? (
                            <code style={{
                              padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem',
                              background: '#f3f4f6', color: '#374151', fontFamily: 'monospace'
                            }}>
                              {user.initial_password}
                            </code>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>--</span>
                          )}
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
                          {showDeleteConfirm === user.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteUser(user)}
                                style={{
                                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                                  background: '#dc2626', color: 'white', border: 'none', cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setShowDeleteConfirm(null)}
                                style={{
                                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                                  background: '#e5e7eb', color: '#374151', border: 'none', cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setShowDeleteConfirm(user.id)}
                              style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600',
                                background: '#fee2e2', color: '#dc2626', border: 'none', cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              Delete
                            </button>
                          )}
                          {isDevMode && onViewAs && (
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
          </div>
        </>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="um-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="um-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create User Account</h3>
            <form onSubmit={handleCreateUser}>
              <div className="um-form-group">
                <label>Account Type</label>
                <div className="um-type-toggle">
                  <button
                    type="button"
                    className={`um-type-btn ${newUser.organizationId !== PPA_ORG_ID ? 'active' : ''}`}
                    onClick={() => setNewUser({...newUser, organizationId: '', selectedOrgIds: [], role: 'Admin'})}
                  >
                    LOJIK Client
                  </button>
                  <button
                    type="button"
                    className={`um-type-btn ${newUser.organizationId === PPA_ORG_ID ? 'active' : ''}`}
                    onClick={() => setNewUser({...newUser, organizationId: PPA_ORG_ID, selectedOrgIds: [], role: 'Management'})}
                  >
                    PPA Internal
                  </button>
                </div>
              </div>

              {newUser.organizationId !== PPA_ORG_ID && (
                <div className="um-form-group">
                  <label>Assigned Towns</label>
                  <div className="um-org-checklist">
                    {orgList.filter(org => org.org_type !== 'internal').map(org => (
                      <label
                        key={org.id}
                        className={`um-org-item ${newUser.selectedOrgIds.includes(org.id) ? 'selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={newUser.selectedOrgIds.includes(org.id)}
                          onChange={(e) => {
                            const updated = e.target.checked
                              ? [...newUser.selectedOrgIds, org.id]
                              : newUser.selectedOrgIds.filter(id => id !== org.id);
                            setNewUser({
                              ...newUser,
                              selectedOrgIds: updated,
                              organizationId: updated[0] || ''
                            });
                          }}
                        />
                        <span className="um-org-name">{org.name}</span>
                      </label>
                    ))}
                  </div>
                  {newUser.selectedOrgIds.length > 0 && (
                    <div className="um-org-count">
                      {newUser.selectedOrgIds.length} {newUser.selectedOrgIds.length === 1 ? 'town' : 'towns'} selected
                      {newUser.selectedOrgIds.length > 1 && ' — user will see all towns on login'}
                    </div>
                  )}
                </div>
              )}

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
                    type="text"
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    placeholder="Min 6 characters"
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label>Confirm Password *</label>
                  <input
                    type="text"
                    value={newUser.confirmPassword}
                    onChange={(e) => setNewUser({...newUser, confirmPassword: e.target.value})}
                    placeholder="Confirm password"
                    required
                    autoComplete="off"
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
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
              Set a new password for {selectedUser.email}
            </p>
            {selectedUser.initial_password && (
              <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '1rem' }}>
                Current stored password: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>{selectedUser.initial_password}</code>
              </p>
            )}
            <form onSubmit={handleResetPassword}>
              <div className="um-form-group">
                <label>New Password *</label>
                <input
                  type="text"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="um-modal-actions">
                <button type="button" onClick={() => { setShowResetModal(false); setResetPassword(''); }}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Update Password
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
