import React from 'react';
import './RevenueManagement.css';

const RevenueManagement = () => {
  return (
    <div className="revenue-container">
      <div className="revenue-header">
        <h2>Revenue Management</h2>
      </div>

      <div className="revenue-placeholder">
        <div className="placeholder-icon">💰</div>
        <h3>Coming Soon</h3>
        <p>
          This section will allow you to:
        </p>
        <ul>
          <li>Generate PDF invoices for client organizations</li>
          <li>Track invoice status (Sent → PO Received → Paid)</li>
          <li>View revenue summaries and totals</li>
          <li>Manage renewal dates and send reminders</li>
          <li>Calculate fees based on line items and user counts</li>
        </ul>
        <p className="placeholder-note">
          Use the <strong>Organizations</strong> tab to add and manage client organizations first.
          Their billing information will flow into this Revenue dashboard.
        </p>
      </div>

      {/* Preview of what the dashboard might look like */}
      <div className="revenue-preview">
        <h4>Dashboard Preview</h4>
        <div className="preview-cards">
          <div className="preview-card">
            <div className="preview-label">Total Revenue (Annual)</div>
            <div className="preview-value">$--,---</div>
          </div>
          <div className="preview-card">
            <div className="preview-label">Outstanding Invoices</div>
            <div className="preview-value">--</div>
          </div>
          <div className="preview-card">
            <div className="preview-label">Awaiting PO</div>
            <div className="preview-value">--</div>
          </div>
          <div className="preview-card">
            <div className="preview-label">Renewals This Month</div>
            <div className="preview-value">--</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevenueManagement;
