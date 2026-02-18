import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import './RevenueManagement.css';

const RevenueManagement = () => {
  const [organizations, setOrganizations] = useState([]);
  const [staffCounts, setStaffCounts] = useState({});
  const [orgCcddCodes, setOrgCcddCodes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Billing year (resets 12/31)
  const [billingYear, setBillingYear] = useState(new Date().getFullYear());

  // Price configuration
  const [priceConfig, setPriceConfig] = useState({
    pricePerLine: 0.10,
    primaryUserFee: 500,
    additionalUserFee: 250
  });

  // Selected client for detail view
  const [selectedClient, setSelectedClient] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Billing status dropdown
  const [openStatusDropdown, setOpenStatusDropdown] = useState(null);
  const statusDropdownRef = useRef(null);

  // Price override editing
  const [editingOverride, setEditingOverride] = useState(null);
  const [overrideValue, setOverrideValue] = useState('');
  const overrideInputRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target)) {
        setOpenStatusDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus override input when editing
  useEffect(() => {
    if (editingOverride && overrideInputRef.current) {
      overrideInputRef.current.focus();
      overrideInputRef.current.select();
    }
  }, [editingOverride]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load organizations (exclude internal/PPA)
      const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .neq('org_type', 'internal')
        .order('name');

      if (orgError) throw orgError;

      // Load staff counts per org
      const { data: employees, error: empError } = await supabase
        .from('employees')
        .select('organization_id');

      if (empError) throw empError;

      const counts = {};
      (employees || []).forEach(emp => {
        if (emp.organization_id) {
          counts[emp.organization_id] = (counts[emp.organization_id] || 0) + 1;
        }
      });

      // Load CCDD codes from jobs per org
      const { data: jobs, error: jobError } = await supabase
        .from('jobs')
        .select('organization_id, ccdd_code')
        .not('ccdd_code', 'is', null);

      if (jobError) throw jobError;

      const ccddMap = {};
      (jobs || []).forEach(job => {
        if (job.organization_id && job.ccdd_code) {
          ccddMap[job.organization_id] = job.ccdd_code;
        }
      });

      setOrganizations(orgs || []);
      setStaffCounts(counts);
      setOrgCcddCodes(ccddMap);
    } catch (err) {
      console.error('Error loading revenue data:', err);
      setError('Failed to load revenue data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate fees for an organization
  const calculateFees = useCallback((org) => {
    if (org.is_free_account || org.subscription_status === 'free') {
      return { lineItemFee: 0, primaryFee: 0, staffFee: 0, total: 0, isFree: true };
    }

    // If annual_fee override is set, use it
    if (org.annual_fee && parseFloat(org.annual_fee) > 0) {
      const overrideTotal = parseFloat(org.annual_fee);
      return { lineItemFee: 0, primaryFee: overrideTotal, staffFee: 0, total: overrideTotal, isFree: false, isOverride: true };
    }

    const lineItems = org.line_item_count || 0;
    const userCount = staffCounts[org.id] || 0;

    const lineItemFee = lineItems * priceConfig.pricePerLine;
    const primaryFee = priceConfig.primaryUserFee;
    const staffFee = Math.max(0, userCount - 1) * priceConfig.additionalUserFee;
    const total = lineItemFee + primaryFee + staffFee;

    return { lineItemFee, primaryFee, staffFee, total, isFree: false, isOverride: false, lineItems, userCount };
  }, [staffCounts, priceConfig]);

  // Billing status helper
  const getBillingStatus = (org) => {
    if (org.is_free_account || org.subscription_status === 'free') return 'free';
    if (org.payment_received_date) return 'paid';
    if (org.po_received_date) return 'po-received';
    if (org.invoice_sent_date) return 'invoiced';
    return 'pending';
  };

  const getBillingLabel = (status) => {
    const labels = {
      free: 'Free',
      paid: 'Paid',
      'po-received': 'PO Received',
      invoiced: 'Invoiced',
      pending: 'Pending'
    };
    return labels[status] || 'Unknown';
  };

  // Revenue summary calculations
  const revenueSummary = useMemo(() => {
    let totalAnnual = 0;
    let totalLineItems = 0;
    let freeAccounts = 0;
    let paidAccounts = 0;
    let totalUsers = 0;
    let collectedRevenue = 0;
    let outstandingRevenue = 0;

    organizations.forEach(org => {
      const fees = calculateFees(org);
      const billingStatus = getBillingStatus(org);
      totalAnnual += fees.total;
      totalLineItems += org.line_item_count || 0;
      totalUsers += staffCounts[org.id] || 0;
      if (fees.isFree) {
        freeAccounts++;
      } else {
        paidAccounts++;
        if (billingStatus === 'paid') {
          collectedRevenue += fees.total;
        } else {
          outstandingRevenue += fees.total;
        }
      }
    });

    return { totalAnnual, totalLineItems, freeAccounts, paidAccounts, totalUsers, collectedRevenue, outstandingRevenue };
  }, [organizations, calculateFees, staffCounts]);

  // Update billing status on org
  const handleBillingStatusChange = async (orgId, newStatus) => {
    try {
      const updateData = {};
      const now = new Date().toISOString().split('T')[0];

      // Set the appropriate date field based on status
      switch (newStatus) {
        case 'paid':
          updateData.payment_received_date = now;
          break;
        case 'po-received':
          updateData.po_received_date = now;
          updateData.payment_received_date = null;
          break;
        case 'invoiced':
          updateData.invoice_sent_date = now;
          updateData.po_received_date = null;
          updateData.payment_received_date = null;
          break;
        case 'pending':
          updateData.invoice_sent_date = null;
          updateData.po_received_date = null;
          updateData.payment_received_date = null;
          break;
        default:
          break;
      }

      const { error: updateError } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', orgId);

      if (updateError) throw updateError;

      // Optimistic update
      setOrganizations(prev => prev.map(org => {
        if (org.id === orgId) {
          return { ...org, ...updateData };
        }
        return org;
      }));

      setOpenStatusDropdown(null);
      setSuccessMessage('Billing status updated');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      console.error('Error updating billing status:', err);
      setError('Failed to update billing status');
      setTimeout(() => setError(''), 3000);
    }
  };

  // Save price override
  const handleSaveOverride = async (orgId) => {
    try {
      const parsedValue = overrideValue === '' ? 0 : parseFloat(overrideValue.replace(/[^0-9.]/g, ''));

      const { error: updateError } = await supabase
        .from('organizations')
        .update({ annual_fee: parsedValue })
        .eq('id', orgId);

      if (updateError) throw updateError;

      // Optimistic update
      setOrganizations(prev => prev.map(org => {
        if (org.id === orgId) {
          return { ...org, annual_fee: parsedValue };
        }
        return org;
      }));

      setEditingOverride(null);
      setOverrideValue('');
      setSuccessMessage('Price override saved');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      console.error('Error saving override:', err);
      setError('Failed to save price override');
      setTimeout(() => setError(''), 3000);
    }
  };

  // Generate PDF invoice for a client
  const generateInvoicePDF = useCallback(async (org) => {
    // Dynamically import jsPDF
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const lojikBlue = [0, 102, 204];

    // Load logo
    let logoDataUrl = null;
    try {
      const response = await fetch('/lojik-logo.PNG');
      const blob = await response.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('Could not load logo:', err);
    }

    // Header
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', margin, margin, 100, 44);
      } catch {
        doc.setTextColor(...lojikBlue);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text('LOJIK', margin, margin + 30);
      }
    } else {
      doc.setTextColor(...lojikBlue);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('LOJIK', margin, margin + 30);
    }

    // Invoice title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', pageWidth - margin, margin + 20, { align: 'right' });

    // Date
    const today = new Date();
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Date: ${today.toLocaleDateString()}`, pageWidth - margin, margin + 36, { align: 'right' });
    const ccdd = orgCcddCodes[org.id] || org.slug?.toUpperCase() || 'ORG';
    doc.text(`Invoice #: ${billingYear}-${ccdd}`, pageWidth - margin, margin + 50, { align: 'right' });

    // Divider
    doc.setDrawColor(...lojikBlue);
    doc.setLineWidth(2);
    doc.line(margin, margin + 65, pageWidth - margin, margin + 65);

    // Bill To section
    let yPos = margin + 90;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', margin, yPos);

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(org.name, margin, yPos + 18);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    let billToY = yPos + 34;
    if (org.primary_contact_name) {
      doc.text(`Attn: ${org.primary_contact_name}`, margin, billToY);
      billToY += 14;
    }
    if (org.billing_address) {
      const addressLines = org.billing_address.split('\n');
      addressLines.forEach((line) => {
        doc.text(line, margin, billToY);
        billToY += 14;
      });
    }
    if (org.primary_contact_email) {
      doc.text(org.primary_contact_email, margin, billToY);
      billToY += 14;
    }

    // From section
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM:', pageWidth - margin - 200, yPos);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('LOJIK', pageWidth - margin - 200, yPos + 18);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('PO BOX 1225', pageWidth - margin - 200, yPos + 32);
    doc.text('DELRAN, NJ 08075', pageWidth - margin - 200, yPos + 44);

    // Fee calculations
    const fees = calculateFees(org);
    const lineItems = org.line_item_count || 0;
    const userCount = staffCounts[org.id] || 0;

    // Line items table
    const invoiceStartY = yPos + 110;

    const rows = [];

    if (fees.isFree) {
      rows.push(['1', 'Free Account - Property Assessment Copilot', '1', '$0.00', '$0.00']);
    } else if (fees.isOverride) {
      // Override: single line item with the fixed amount
      rows.push([
        '1',
        `Property Assessment Copilot - Annual License (${lineItems.toLocaleString()} line items, ${userCount} user${userCount !== 1 ? 's' : ''})`,
        '1',
        `$${fees.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        `$${fees.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      ]);
    } else {
      // Line item fee
      rows.push([
        '1',
        `Data Processing Fee - ${lineItems.toLocaleString()} line items @ $${priceConfig.pricePerLine.toFixed(2)}/line`,
        lineItems.toLocaleString(),
        `$${priceConfig.pricePerLine.toFixed(2)}`,
        `$${fees.lineItemFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ]);

      // Primary user fee
      rows.push([
        '2',
        'Primary User License - Property Assessment Copilot',
        '1',
        `$${priceConfig.primaryUserFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        `$${priceConfig.primaryUserFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      ]);

      // Additional user fees
      const additionalUsers = Math.max(0, userCount - 1);
      if (additionalUsers > 0) {
        rows.push([
          '3',
          `Additional User Licenses (${additionalUsers} users @ $${priceConfig.additionalUserFee}/ea)`,
          additionalUsers.toString(),
          `$${priceConfig.additionalUserFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
          `$${fees.staffFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        ]);
      }
    }

    autoTable(doc, {
      head: [['#', 'Description', 'Qty', 'Unit Price', 'Amount']],
      body: rows,
      startY: invoiceStartY,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 9,
        cellPadding: 8,
        lineColor: [220, 220, 220],
        lineWidth: 0.5
      },
      headStyles: {
        fillColor: lojikBlue,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: {
        0: { cellWidth: 30, halign: 'center' },
        1: { cellWidth: 260 },
        2: { cellWidth: 50, halign: 'center' },
        3: { cellWidth: 80, halign: 'right' },
        4: { cellWidth: 80, halign: 'right', fontStyle: 'bold' }
      }
    });

    // Total section
    const totalY = doc.lastAutoTable.finalY + 15;

    // Subtotal
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Subtotal:', pageWidth - margin - 160, totalY);
    doc.text(
      `$${fees.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      pageWidth - margin,
      totalY,
      { align: 'right' }
    );

    // Divider line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(pageWidth - margin - 200, totalY + 8, pageWidth - margin, totalY + 8);

    // Total
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...lojikBlue);
    doc.text('TOTAL DUE:', pageWidth - margin - 160, totalY + 28);
    doc.text(
      `$${fees.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      pageWidth - margin,
      totalY + 28,
      { align: 'right' }
    );

    // Footer note
    const footerY = totalY + 60;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(140, 140, 140);
    doc.text('Payment terms: Net 30 days from invoice date.', margin, footerY);
    doc.text('Please reference the invoice number on your payment.', margin, footerY + 12);

    // Footer line
    doc.setDrawColor(...lojikBlue);
    doc.setLineWidth(1);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);

    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `LOJIK | Generated ${today.toLocaleDateString()}`,
      pageWidth / 2,
      pageHeight - 25,
      { align: 'center' }
    );

    const ccddFile = orgCcddCodes[org.id] || org.slug || org.name.replace(/\s+/g, '_');
    const fileName = `Invoice_${billingYear}_${ccddFile}.pdf`;
    doc.save(fileName);

    setSuccessMessage(`Invoice generated: ${fileName}`);
    setTimeout(() => setSuccessMessage(''), 3000);
  }, [calculateFees, staffCounts, priceConfig, orgCcddCodes, billingYear]);

  const billingStatusOptions = [
    { value: 'pending', label: 'Pending', color: '#991b1b', bg: '#fee2e2' },
    { value: 'invoiced', label: 'Invoiced', color: '#3730a3', bg: '#e0e7ff' },
    { value: 'po-received', label: 'PO Received', color: '#92400e', bg: '#fef3c7' },
    { value: 'paid', label: 'Paid', color: '#166534', bg: '#dcfce7' }
  ];

  if (loading) {
    return (
      <div className="revenue-container">
        <div className="revenue-header">
          <h2>Revenue Management</h2>
        </div>
        <div className="revenue-loading">Loading revenue data...</div>
      </div>
    );
  }

  return (
    <div className="revenue-container">
      <div className="revenue-header">
        <h2>Revenue Management</h2>
        <div className="revenue-header-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Billing Year:</label>
            <select
              value={billingYear}
              onChange={(e) => setBillingYear(parseInt(e.target.value))}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                background: '#fff'
              }}
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <button
            className="revenue-config-btn"
            onClick={() => setShowInvoiceModal(true)}
          >
            Pricing Config
          </button>
        </div>
      </div>

      {error && <div className="revenue-error">{error}</div>}
      {successMessage && <div className="revenue-success">{successMessage}</div>}

      {/* Summary Cards */}
      <div className="revenue-summary">
        <div className="revenue-card revenue-card-primary">
          <div className="revenue-card-label">Total Annual Revenue</div>
          <div className="revenue-card-value">
            ${revenueSummary.totalAnnual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="revenue-card revenue-card-collected">
          <div className="revenue-card-label">Collected</div>
          <div className="revenue-card-value" style={{ color: '#166534' }}>
            ${revenueSummary.collectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="revenue-card revenue-card-outstanding">
          <div className="revenue-card-label">Outstanding</div>
          <div className="revenue-card-value" style={{ color: '#dc2626' }}>
            ${revenueSummary.outstandingRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="revenue-card">
          <div className="revenue-card-label">Paid Clients</div>
          <div className="revenue-card-value">{revenueSummary.paidAccounts}</div>
        </div>
        <div className="revenue-card">
          <div className="revenue-card-label">Free Accounts</div>
          <div className="revenue-card-value">{revenueSummary.freeAccounts}</div>
        </div>
        <div className="revenue-card">
          <div className="revenue-card-label">Total Line Items</div>
          <div className="revenue-card-value">{revenueSummary.totalLineItems.toLocaleString()}</div>
        </div>
        <div className="revenue-card">
          <div className="revenue-card-label">Total Users</div>
          <div className="revenue-card-value">{revenueSummary.totalUsers}</div>
        </div>
      </div>

      {/* Pricing Rate Display */}
      <div className="revenue-rates">
        <span className="rate-chip">
          ${priceConfig.pricePerLine.toFixed(2)}/line item
        </span>
        <span className="rate-chip">
          ${priceConfig.primaryUserFee.toLocaleString()} primary user
        </span>
        <span className="rate-chip">
          ${priceConfig.additionalUserFee.toLocaleString()}/additional user
        </span>
      </div>

      {/* Client Revenue Table */}
      <div className="revenue-table-wrapper">
        <table className="revenue-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Line Items</th>
              <th className="revenue-col-right">Line Item Fee</th>
              <th>Users</th>
              <th className="revenue-col-right">User Fees</th>
              <th>Account Type</th>
              <th>Billing Status</th>
              <th className="revenue-col-right">Annual Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map(org => {
              const fees = calculateFees(org);
              const userCount = staffCounts[org.id] || 0;
              const billingStatus = getBillingStatus(org);
              const isDropdownOpen = openStatusDropdown === org.id;

              return (
                <tr key={org.id} className={fees.isFree ? 'revenue-row-free' : ''}>
                  <td>
                    <div className="revenue-client-name">{org.name}</div>
                    <div className="revenue-client-contact">{org.primary_contact_name || ''}</div>
                  </td>
                  <td>{(org.line_item_count || 0).toLocaleString()}</td>
                  <td className="revenue-col-right">
                    {fees.isFree ? '-' : fees.isOverride ? '-' : `$${fees.lineItemFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  </td>
                  <td>{userCount}</td>
                  <td className="revenue-col-right">
                    {fees.isFree ? '-' : fees.isOverride ? '-' : `$${(fees.primaryFee + fees.staffFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  </td>
                  <td>
                    <span className={`revenue-account-badge ${fees.isFree ? 'revenue-badge-free' : 'revenue-badge-paid'}`}>
                      {fees.isFree ? 'Free' : 'Paid'}
                    </span>
                  </td>
                  <td style={{ position: 'relative' }}>
                    {billingStatus === 'free' ? (
                      <span className="revenue-billing-badge revenue-billing-free">Free</span>
                    ) : (
                      <div style={{ position: 'relative', display: 'inline-block' }} ref={isDropdownOpen ? statusDropdownRef : null}>
                        <button
                          className={`revenue-billing-badge revenue-billing-${billingStatus} revenue-status-btn`}
                          onClick={() => setOpenStatusDropdown(isDropdownOpen ? null : org.id)}
                          title="Click to change billing status"
                        >
                          {getBillingLabel(billingStatus)}
                          <span style={{ marginLeft: '4px', fontSize: '0.6rem' }}>&#9662;</span>
                        </button>
                        {isDropdownOpen && (
                          <div className="revenue-status-dropdown">
                            {billingStatusOptions.map(opt => (
                              <button
                                key={opt.value}
                                className={`revenue-status-option ${billingStatus === opt.value ? 'revenue-status-active' : ''}`}
                                style={{ '--opt-bg': opt.bg, '--opt-color': opt.color }}
                                onClick={() => handleBillingStatusChange(org.id, opt.value)}
                              >
                                <span className="revenue-status-dot" style={{ background: opt.color }}></span>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="revenue-col-right revenue-total-cell">
                    {editingOverride === org.id ? (
                      <div className="revenue-override-edit">
                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>$</span>
                        <input
                          ref={overrideInputRef}
                          type="text"
                          className="revenue-override-input"
                          value={overrideValue}
                          onChange={(e) => setOverrideValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveOverride(org.id);
                            if (e.key === 'Escape') { setEditingOverride(null); setOverrideValue(''); }
                          }}
                          onBlur={() => handleSaveOverride(org.id)}
                          placeholder="0.00"
                        />
                      </div>
                    ) : (
                      <div
                        className="revenue-total-editable"
                        onClick={() => {
                          if (!fees.isFree) {
                            setEditingOverride(org.id);
                            setOverrideValue(org.annual_fee && parseFloat(org.annual_fee) > 0 ? parseFloat(org.annual_fee).toFixed(2) : fees.total.toFixed(2));
                          }
                        }}
                        title={fees.isFree ? '' : `Click to set price override${fees.isOverride ? ' (currently overridden)' : ''}`}
                      >
                        <span>
                          ${fees.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {fees.isOverride && <span className="revenue-override-indicator">*</span>}
                        {!fees.isFree && <span className="revenue-edit-icon">&#9998;</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="revenue-pdf-btn"
                      onClick={() => generateInvoicePDF(org)}
                      title="Generate Invoice PDF"
                    >
                      PDF
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="revenue-totals-row">
              <td>Totals</td>
              <td>{revenueSummary.totalLineItems.toLocaleString()}</td>
              <td className="revenue-col-right">
                ${organizations.reduce((sum, o) => { const f = calculateFees(o); return sum + (f.isOverride ? 0 : f.lineItemFee); }, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td>{revenueSummary.totalUsers}</td>
              <td className="revenue-col-right">
                ${organizations.reduce((sum, o) => { const f = calculateFees(o); return sum + (f.isOverride ? 0 : f.primaryFee + f.staffFee); }, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td></td>
              <td></td>
              <td className="revenue-col-right revenue-total-cell">
                ${revenueSummary.totalAnnual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pricing Configuration Modal */}
      {showInvoiceModal && (
        <div className="revenue-modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="revenue-modal" onClick={e => e.stopPropagation()}>
            <div className="revenue-modal-header">
              <h3>Pricing Configuration</h3>
              <button className="revenue-modal-close" onClick={() => setShowInvoiceModal(false)}>X</button>
            </div>
            <div className="revenue-modal-body">
              <div className="revenue-form-group">
                <label>Price Per Line Item ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceConfig.pricePerLine}
                  onChange={e => setPriceConfig(prev => ({ ...prev, pricePerLine: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="revenue-form-group">
                <label>Primary User Fee ($)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={priceConfig.primaryUserFee}
                  onChange={e => setPriceConfig(prev => ({ ...prev, primaryUserFee: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="revenue-form-group">
                <label>Additional User Fee ($)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={priceConfig.additionalUserFee}
                  onChange={e => setPriceConfig(prev => ({ ...prev, additionalUserFee: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="revenue-config-preview">
                <h4>Fee Structure Preview</h4>
                <p>Line Items: ${priceConfig.pricePerLine.toFixed(2)} x count</p>
                <p>Primary User: ${priceConfig.primaryUserFee.toLocaleString()}</p>
                <p>Each Add'l User: ${priceConfig.additionalUserFee.toLocaleString()}</p>
              </div>
            </div>
            <div className="revenue-modal-footer">
              <button className="revenue-modal-save" onClick={() => setShowInvoiceModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RevenueManagement;
