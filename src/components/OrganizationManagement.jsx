import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './OrganizationManagement.css';

const OrganizationManagement = () => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgStaff, setOrgStaff] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  // Form state for new organization
  const [newOrg, setNewOrg] = useState({
    name: '',
    slug: '',
    primary_contact_name: '',
    primary_contact_email: '',
    billing_address: '',
    line_item_count: 0,
    single_job_mode: false,
    is_free_account: false
  });

  // Form state for new staff member
  const [newStaff, setNewStaff] = useState({
    first_name: '',
    last_name: '',
    email: '',
    role: 'staff',
    is_primary: false
  });

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .neq('org_type', 'internal') // Exclude PPA
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (err) {
      console.error('Error loading organizations:', err);
      setError('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const loadOrgStaff = async (orgId) => {
    try {
      setLoadingStaff(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('organization_id', orgId)
        .order('last_name');

      if (error) throw error;
      setOrgStaff(data || []);
    } catch (err) {
      console.error('Error loading staff:', err);
      setError('Failed to load staff');
    } finally {
      setLoadingStaff(false);
    }
  };

  const handleCreateOrg = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    try {
      // Generate slug from name if not provided
      const slug = newOrg.slug || newOrg.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const { error } = await supabase
        .from('organizations')
        .insert({
          name: newOrg.name,
          slug: slug,
          org_type: 'assessor',
          primary_contact_name: newOrg.primary_contact_name,
          primary_contact_email: newOrg.primary_contact_email,
          billing_address: newOrg.billing_address,
          line_item_count: newOrg.line_item_count || 0,
          single_job_mode: newOrg.single_job_mode,
          is_free_account: newOrg.is_free_account,
          subscription_status: newOrg.is_free_account ? 'free' : 'active',
          annual_fee: newOrg.is_free_account ? 0 : null,
          tab_config: {
            staffing: true,
            jobs: true,
            appeal_coverage: true,
            billing: false,
            payroll: false
          }
        });

      if (error) throw error;

      setSuccessMessage('Organization created successfully');
      setShowCreateModal(false);
      setNewOrg({
        name: '',
        slug: '',
        primary_contact_name: '',
        primary_contact_email: '',
        billing_address: '',
        line_item_count: 0,
        single_job_mode: false,
        is_free_account: false
      });
      loadOrganizations();
    } catch (err) {
      console.error('Error creating organization:', err);
      setError(err.message || 'Failed to create organization');
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setError('');

    try {
      // Generate employee_number for org staff: ORG-<slug>-<timestamp>
      const empNumber = `ORG-${selectedOrg.slug?.substring(0, 10) || 'EXT'}-${Date.now().toString(36).toUpperCase()}`;

      const { error } = await supabase
        .from('employees')
        .insert({
          first_name: newStaff.first_name,
          last_name: newStaff.last_name,
          email: newStaff.email,
          employee_number: empNumber,
          role: newStaff.is_primary ? 'Admin' : 'Management',
          organization_id: selectedOrg.id,
          employment_status: 'full_time',
          has_account: false
        });

      if (error) throw error;

      setSuccessMessage('Staff member added successfully');
      setNewStaff({
        first_name: '',
        last_name: '',
        email: '',
        role: 'staff',
        is_primary: false
      });
      loadOrgStaff(selectedOrg.id);
    } catch (err) {
      console.error('Error adding staff:', err);
      setError(err.message || 'Failed to add staff member');
    }
  };

  const handleViewStaff = (org) => {
    setSelectedOrg(org);
    setShowStaffModal(true);
    loadOrgStaff(org.id);
  };

  const calculateAnnualFee = (lineItems, staffCount) => {
    // Base: $0.10 per line item (primary cards only)
    // Primary user: $500
    // Additional staff: $250 each
    const lineItemFee = lineItems * 0.10;
    const primaryFee = 500;
    const staffFee = Math.max(0, staffCount - 1) * 250;
    return lineItemFee + primaryFee + staffFee;
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      active: 'status-active',
      suspended: 'status-suspended',
      cancelled: 'status-cancelled',
      trial: 'status-trial'
    };
    return statusClasses[status] || 'status-active';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="org-management-container">
      <div className="org-header">
        <h2>Organization Management</h2>
        <button 
          className="create-org-btn"
          onClick={() => setShowCreateModal(true)}
        >
          + Add Client Organization
        </button>
      </div>

      {error && <div className="org-error">{error}</div>}
      {successMessage && <div className="org-success">{successMessage}</div>}

      {/* Summary Cards */}
      <div className="org-summary-cards">
        <div className="summary-card">
          <div className="summary-value">{organizations.length}</div>
          <div className="summary-label">Total Clients</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">
            {organizations.filter(o => o.subscription_status === 'active').length}
          </div>
          <div className="summary-label">Active</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">
            {organizations.reduce((sum, o) => sum + (o.line_item_count || 0), 0).toLocaleString()}
          </div>
          <div className="summary-label">Total Line Items</div>
        </div>
      </div>

      {loading ? (
        <div className="org-loading">Loading organizations...</div>
      ) : organizations.length === 0 ? (
        <div className="org-empty">
          <p>No client organizations yet.</p>
          <p>Click "Add Client Organization" to add your first Lojik client.</p>
        </div>
      ) : (
        <div className="org-table-container">
          <table className="org-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Contact</th>
                <th>Line Items</th>
                <th>Status</th>
                <th>Billing Status</th>
                <th>Renewal</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map(org => (
                <tr key={org.id}>
                  <td>
                    <div className="org-name">{org.name}</div>
                    <div className="org-slug">/{org.slug}</div>
                  </td>
                  <td>
                    <div>{org.primary_contact_name || '-'}</div>
                    <div className="org-email">{org.primary_contact_email || '-'}</div>
                  </td>
                  <td>{(org.line_item_count || 0).toLocaleString()}</td>
                  <td>
                    <span className={`status-badge ${getStatusBadge(org.subscription_status)}`}>
                      {org.subscription_status || 'active'}
                    </span>
                  </td>
                  <td>
                    <div className="billing-status">
                      {org.is_free_account || org.subscription_status === 'free' ? (
                        <span className="billing-paid" style={{ background: '#dcfce7', color: '#166534' }}>Free</span>
                      ) : org.payment_received_date ? (
                        <span className="billing-paid">Paid</span>
                      ) : org.po_received_date ? (
                        <span className="billing-po">PO Received</span>
                      ) : org.invoice_sent_date ? (
                        <span className="billing-invoiced">Invoiced</span>
                      ) : (
                        <span className="billing-pending">Pending</span>
                      )}
                    </div>
                  </td>
                  <td>{formatDate(org.renewal_date)}</td>
                  <td>
                    <div className="org-actions">
                      <button
                        className="staff-btn"
                        onClick={() => handleViewStaff(org)}
                      >
                        Staff
                      </button>
                      <button className="edit-btn">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="org-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="org-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Client Organization</h3>
            <form onSubmit={handleCreateOrg}>
              <div className="org-form-group">
                <label>Organization Name *</label>
                <input
                  type="text"
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({...newOrg, name: e.target.value})}
                  placeholder="e.g., Borough of Rumson"
                  required
                />
              </div>

              <div className="org-form-row">
                <div className="org-form-group">
                  <label>Primary Contact Name</label>
                  <input
                    type="text"
                    value={newOrg.primary_contact_name}
                    onChange={(e) => setNewOrg({...newOrg, primary_contact_name: e.target.value})}
                    placeholder="John Smith"
                  />
                </div>
                <div className="org-form-group">
                  <label>Primary Contact Email</label>
                  <input
                    type="email"
                    value={newOrg.primary_contact_email}
                    onChange={(e) => setNewOrg({...newOrg, primary_contact_email: e.target.value})}
                    placeholder="assessor@township.gov"
                  />
                </div>
              </div>

              <div className="org-form-group">
                <label>Billing Address</label>
                <textarea
                  value={newOrg.billing_address}
                  onChange={(e) => setNewOrg({...newOrg, billing_address: e.target.value})}
                  placeholder="123 Main St, Township, NJ 07001"
                  rows={2}
                />
              </div>

              <div className="org-form-row">
                <div className="org-form-group">
                  <label>Line Item Count (Primary Cards)</label>
                  <input
                    type="number"
                    value={newOrg.line_item_count}
                    onChange={(e) => setNewOrg({...newOrg, line_item_count: parseInt(e.target.value) || 0})}
                    placeholder="0"
                  />
                </div>
                <div className="org-form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={newOrg.single_job_mode}
                      onChange={(e) => setNewOrg({...newOrg, single_job_mode: e.target.checked})}
                    />
                    Single Job Mode (skip job list on login)
                  </label>
                  <label style={{ marginTop: '8px', display: 'block' }}>
                    <input
                      type="checkbox"
                      checked={newOrg.is_free_account}
                      onChange={(e) => setNewOrg({...newOrg, is_free_account: e.target.checked})}
                    />
                    Free Account (no invoicing)
                  </label>
                </div>
              </div>

              {newOrg.line_item_count > 0 && !newOrg.is_free_account && (
                <div className="fee-preview">
                  <strong>Estimated Annual Fee:</strong> ${calculateAnnualFee(newOrg.line_item_count, 1).toLocaleString()}
                  <div className="fee-breakdown">
                    Line Items: ${(newOrg.line_item_count * 0.10).toFixed(2)} + Primary User: $500
                  </div>
                </div>
              )}
              {newOrg.is_free_account && (
                <div className="fee-preview" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <strong style={{ color: '#166534' }}>Free Account</strong>
                  <div className="fee-breakdown" style={{ color: '#15803d' }}>
                    No invoices will be generated for this organization
                  </div>
                </div>
              )}

              <div className="org-modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Create Organization
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Management Modal */}
      {showStaffModal && selectedOrg && (
        <div className="org-modal-overlay" onClick={() => setShowStaffModal(false)}>
          <div className="org-modal staff-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Staff - {selectedOrg.name}</h3>
            
            {loadingStaff ? (
              <div className="org-loading">Loading staff...</div>
            ) : (
              <>
                <div className="staff-list">
                  {orgStaff.length === 0 ? (
                    <p className="no-staff">No staff members yet.</p>
                  ) : (
                    <table className="staff-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Has Account</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orgStaff.map(staff => (
                          <tr key={staff.id}>
                            <td>{staff.first_name} {staff.last_name}</td>
                            <td>{staff.email}</td>
                            <td>{staff.role}</td>
                            <td>
                              <span className={staff.has_account ? 'has-account' : 'no-account'}>
                                {staff.has_account ? 'Yes' : 'No'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="add-staff-section">
                  <h4>Add Staff Member</h4>
                  <form onSubmit={handleAddStaff}>
                    <div className="org-form-row">
                      <div className="org-form-group">
                        <input
                          type="text"
                          value={newStaff.first_name}
                          onChange={(e) => setNewStaff({...newStaff, first_name: e.target.value})}
                          placeholder="First Name"
                          required
                        />
                      </div>
                      <div className="org-form-group">
                        <input
                          type="text"
                          value={newStaff.last_name}
                          onChange={(e) => setNewStaff({...newStaff, last_name: e.target.value})}
                          placeholder="Last Name"
                          required
                        />
                      </div>
                    </div>
                    <div className="org-form-row">
                      <div className="org-form-group">
                        <input
                          type="email"
                          value={newStaff.email}
                          onChange={(e) => setNewStaff({...newStaff, email: e.target.value})}
                          placeholder="Email"
                          required
                        />
                      </div>
                      <div className="org-form-group checkbox-group">
                        <label>
                          <input
                            type="checkbox"
                            checked={newStaff.is_primary}
                            onChange={(e) => setNewStaff({...newStaff, is_primary: e.target.checked})}
                          />
                          Primary User ($500/yr)
                        </label>
                      </div>
                    </div>
                    <button type="submit" className="add-staff-btn">
                      + Add Staff
                    </button>
                  </form>
                </div>

                {orgStaff.length > 0 && (
                  <div className="staff-fee-summary">
                    <strong>Staff Fees:</strong> ${(500 + Math.max(0, orgStaff.length - 1) * 250).toLocaleString()}/year
                    <span className="fee-detail">
                      (1 Primary @ $500 + {Math.max(0, orgStaff.length - 1)} Staff @ $250 each)
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="org-modal-actions">
              <button onClick={() => setShowStaffModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationManagement;
