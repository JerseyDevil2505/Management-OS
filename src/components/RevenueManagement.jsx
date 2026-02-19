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

  // Tiered price configuration
  const [priceConfig, setPriceConfig] = useState({
    tiers: [
      { maxLines: 1000, rate: 0.24 },
      { maxLines: 5000, rate: 0.12 },
      { maxLines: 15000, rate: 0.10 },
      { maxLines: Infinity, rate: 0.10 }
    ],
    primaryUserFee: 500,
    additionalUserFee: 250
  });

  // Get the per-line rate for a given count based on tier
  const getEffectiveRate = useCallback((lineCount) => {
    if (lineCount <= 0) return priceConfig.tiers[0]?.rate || 0;
    for (const tier of priceConfig.tiers) {
      if (lineCount <= tier.maxLines) return tier.rate;
    }
    return priceConfig.tiers[priceConfig.tiers.length - 1]?.rate || 0;
  }, [priceConfig.tiers]);

  // Calculate line item fee using flat tier (all lines at the rate for their tier)
  const calculateTieredLineItemFee = useCallback((lineCount) => {
    return lineCount * getEffectiveRate(lineCount);
  }, [getEffectiveRate]);

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

  // Proposals
  const [proposals, setProposals] = useState([]);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [editingProposal, setEditingProposal] = useState(null);
  const [proposalForm, setProposalForm] = useState({
    town_name: '',
    assessor_name: '',
    address: '',
    email: '',
    line_items: '',
    users: '1',
    proposed_price: '',
    notes: ''
  });

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

      // Load proposals
      const { data: proposalData, error: proposalError } = await supabase
        .from('proposals')
        .select('*')
        .order('created_at', { ascending: false });

      if (proposalError) console.error('Error loading proposals:', proposalError);

      setOrganizations(orgs || []);
      setStaffCounts(counts);
      setOrgCcddCodes(ccddMap);
      setProposals(proposalData || []);
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

    const lineItemFee = calculateTieredLineItemFee(lineItems);
    const primaryFee = priceConfig.primaryUserFee;
    const staffFee = Math.max(0, userCount - 1) * priceConfig.additionalUserFee;
    const total = lineItemFee + primaryFee + staffFee;
    const effectiveRate = getEffectiveRate(lineItems);

    return { lineItemFee, primaryFee, staffFee, total, isFree: false, isOverride: false, lineItems, userCount, effectiveRate };
  }, [staffCounts, priceConfig, calculateTieredLineItemFee, getEffectiveRate]);

  // View Open Invoices filter
  const [showOpenOnly, setShowOpenOnly] = useState(false);

  // Billing status helper — free / open / sent / paid
  const getBillingStatus = (org) => {
    if (org.is_free_account || org.subscription_status === 'free') return 'free';
    if (org.payment_received_date) return 'paid';
    if (org.invoice_sent_date) return 'sent';
    return 'open';
  };

  const getBillingLabel = (status) => {
    const labels = { free: 'Free', paid: 'Paid', open: 'Open', sent: 'Sent' };
    return labels[status] || 'Unknown';
  };

  // Invoice aging — days since Jan 1 of billing year (or sent date if available)
  const getInvoiceAge = (org) => {
    const status = getBillingStatus(org);
    if (status === 'free' || status === 'paid') return null;
    const refDate = org.invoice_sent_date
      ? new Date(org.invoice_sent_date)
      : new Date(billingYear, 0, 1);
    const today = new Date();
    const diffDays = Math.floor((today - refDate) / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const getAgingColor = (days) => {
    if (days === null) return '';
    if (days < 30) return '#6b7280';
    if (days < 60) return '#ca8a04';
    if (days < 90) return '#ea580c';
    return '#dc2626';
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

    let sentCount = 0;
    let openCount = 0;

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
          if (billingStatus === 'sent') sentCount++;
          else openCount++;
        }
      }
    });

    return { totalAnnual, totalLineItems, freeAccounts, paidAccounts, totalUsers, collectedRevenue, outstandingRevenue, sentCount, openCount };
  }, [organizations, calculateFees, staffCounts]);

  // Update billing status on org
  const handleBillingStatusChange = async (orgId, newStatus) => {
    try {
      const updateData = {};
      const now = new Date().toISOString().split('T')[0];

      // Set dates based on status
      if (newStatus === 'paid') {
        updateData.payment_received_date = now;
      } else if (newStatus === 'sent') {
        updateData.payment_received_date = null;
        updateData.invoice_sent_date = now;
      } else {
        // open
        updateData.payment_received_date = null;
        updateData.invoice_sent_date = null;
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

  // --- Proposal handlers ---
  const resetProposalForm = () => {
    setProposalForm({ town_name: '', assessor_name: '', address: '', email: '', line_items: '', users: '1', proposed_price: '', notes: '' });
    setEditingProposal(null);
  };

  const handleSaveProposal = async () => {
    if (!proposalForm.town_name || !proposalForm.proposed_price) {
      setError('Town name and price are required');
      setTimeout(() => setError(''), 3000);
      return;
    }
    try {
      const data = {
        town_name: proposalForm.town_name,
        assessor_name: proposalForm.assessor_name || null,
        address: proposalForm.address || null,
        email: proposalForm.email || null,
        proposed_price: parseFloat(proposalForm.proposed_price) || 0,
        notes: proposalForm.notes || null
      };

      if (editingProposal) {
        const { error: updateErr } = await supabase
          .from('proposals').update(data).eq('id', editingProposal.id);
        if (updateErr) throw updateErr;
        setProposals(prev => prev.map(p => p.id === editingProposal.id ? { ...p, ...data } : p));
      } else {
        const { data: newRow, error: insertErr } = await supabase
          .from('proposals').insert(data).select().single();
        if (insertErr) throw insertErr;
        setProposals(prev => [newRow, ...prev]);
      }
      setShowProposalModal(false);
      resetProposalForm();
      setSuccessMessage(editingProposal ? 'Proposal updated' : 'Proposal created');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      console.error('Error saving proposal:', err);
      setError('Failed to save proposal');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleDeleteProposal = async (id) => {
    if (!window.confirm('Delete this proposal?')) return;
    try {
      const { error: delErr } = await supabase.from('proposals').delete().eq('id', id);
      if (delErr) throw delErr;
      setProposals(prev => prev.filter(p => p.id !== id));
      setSuccessMessage('Proposal deleted');
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err) {
      console.error('Error deleting proposal:', err);
    }
  };

  const handleProposalStatusChange = async (id, newStatus) => {
    try {
      const { error: updateErr } = await supabase
        .from('proposals').update({ status: newStatus }).eq('id', id);
      if (updateErr) throw updateErr;
      setProposals(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
    } catch (err) {
      console.error('Error updating proposal status:', err);
    }
  };

  const handleRolloverProposal = async (proposal) => {
    if (!window.confirm(`Onboard "${proposal.town_name}" as a new client? This will create an organization and mark the proposal as accepted.`)) return;
    try {
      // Create organization
      const orgData = {
        name: proposal.town_name,
        org_type: 'assessor',
        primary_contact_name: proposal.assessor_name || null,
        primary_contact_email: proposal.email || null,
        billing_address: proposal.address || null,
        annual_fee: proposal.proposed_price || 0,
        subscription_status: 'active',
        is_free_account: false
      };
      const { data: newOrg, error: orgErr } = await supabase
        .from('organizations').insert(orgData).select().single();
      if (orgErr) throw orgErr;

      // Update proposal
      const { error: propErr } = await supabase
        .from('proposals')
        .update({ status: 'accepted', converted_org_id: newOrg.id })
        .eq('id', proposal.id);
      if (propErr) throw propErr;

      setProposals(prev => prev.map(p => p.id === proposal.id ? { ...p, status: 'accepted', converted_org_id: newOrg.id } : p));
      setOrganizations(prev => [...prev, newOrg].sort((a, b) => a.name.localeCompare(b.name)));

      setSuccessMessage(`${proposal.town_name} onboarded successfully!`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error rolling over proposal:', err);
      setError('Failed to onboard client');
      setTimeout(() => setError(''), 3000);
    }
  };

  // Generate Proposal PDF (mirrors invoice format)
  const generateProposalPDF = useCallback(async (proposal) => {
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
      try { doc.addImage(logoDataUrl, 'PNG', margin, margin, 100, 44); }
      catch { doc.setTextColor(...lojikBlue); doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text('LOJIK', margin, margin + 30); }
    } else {
      doc.setTextColor(...lojikBlue); doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.text('LOJIK', margin, margin + 30);
    }

    // PROPOSAL title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('PROPOSAL', pageWidth - margin, margin + 20, { align: 'right' });

    const today = new Date();
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Date: ${today.toLocaleDateString()}`, pageWidth - margin, margin + 36, { align: 'right' });
    const refNum = `P-${billingYear}-${proposal.town_name.replace(/\s+/g, '').substring(0, 6).toUpperCase()}`;
    doc.text(`Ref #: ${refNum}`, pageWidth - margin, margin + 50, { align: 'right' });

    // Divider
    doc.setDrawColor(...lojikBlue);
    doc.setLineWidth(2);
    doc.line(margin, margin + 65, pageWidth - margin, margin + 65);

    // Prepared For
    let yPos = margin + 90;
    doc.setFontSize(10); doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'bold');
    doc.text('PREPARED FOR:', margin, yPos);
    doc.setFontSize(12); doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
    doc.text(proposal.town_name, margin, yPos + 18);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    let contactY = yPos + 34;
    if (proposal.assessor_name) { doc.text(`Attn: ${proposal.assessor_name}`, margin, contactY); contactY += 14; }
    if (proposal.address) {
      proposal.address.split('\n').forEach(line => { doc.text(line, margin, contactY); contactY += 14; });
    }
    if (proposal.email) { doc.text(proposal.email, margin, contactY); contactY += 14; }

    // From
    doc.setFontSize(10); doc.setTextColor(100, 100, 100); doc.setFont('helvetica', 'bold');
    doc.text('FROM:', pageWidth - margin - 200, yPos);
    doc.setFontSize(11); doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
    doc.text('LOJIK', pageWidth - margin - 200, yPos + 18);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    doc.text('PO BOX 1225', pageWidth - margin - 200, yPos + 32);
    doc.text('DELRAN, NJ 08075', pageWidth - margin - 200, yPos + 44);

    // Services table
    const invoiceStartY = yPos + 110;
    const rows = [
      ['1', 'Property Assessment Copilot - Annual License\nFull platform access: data quality, market analysis, land valuation, final valuation, appeal tracking', '1',
        `$${parseFloat(proposal.proposed_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        `$${parseFloat(proposal.proposed_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`]
    ];

    autoTable(doc, {
      head: [['#', 'Description', 'Qty', 'Unit Price', 'Amount']],
      body: rows,
      startY: invoiceStartY,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 8, lineColor: [220, 220, 220], lineWidth: 0.5 },
      headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 30, halign: 'center' },
        1: { cellWidth: 260 },
        2: { cellWidth: 50, halign: 'center' },
        3: { cellWidth: 80, halign: 'right' },
        4: { cellWidth: 80, halign: 'right', fontStyle: 'bold' }
      }
    });

    const totalY = doc.lastAutoTable.finalY + 15;
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.5);
    doc.line(pageWidth - margin - 200, totalY, pageWidth - margin, totalY);
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...lojikBlue);
    doc.text('PROPOSED TOTAL:', pageWidth - margin - 160, totalY + 20);
    doc.text(`$${parseFloat(proposal.proposed_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, pageWidth - margin, totalY + 20, { align: 'right' });

    // What's included section
    const featuresY = totalY + 55;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    doc.text('What\'s Included:', margin, featuresY);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
    const features = [
      'Works with BRT and Microsystems CAMA Software',
      'Automated data quality and error checking',
      'Market normalization with HPI data and outlier detection',
      'Land valuation: vacant sales, allocation, depth tables, VCS sheets',
      'Cost conversion analysis with new construction comparables',
      'Sales comparison engine with adjustment grid',
      'Ratable comparison and rate calculator',
      'Page-by-page worksheet for property-level review',
      'Export to Excel at every step'
    ];
    features.forEach((feat, i) => {
      doc.text(`\u2022  ${feat}`, margin + 10, featuresY + 18 + (i * 14));
    });

    // Footer
    doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(140, 140, 140);
    const footerNoteY = featuresY + 18 + (features.length * 14) + 20;
    doc.text('This proposal is valid for 60 days from the date above.', margin, footerNoteY);
    doc.text('Contact us to schedule a live demo with your own data.', margin, footerNoteY + 12);

    doc.setDrawColor(...lojikBlue); doc.setLineWidth(1);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.line(margin, pageHeight - 40, pageWidth - margin, pageHeight - 40);
    doc.setFontSize(8); doc.setTextColor(140, 140, 140); doc.setFont('helvetica', 'normal');
    doc.text(`LOJIK | Generated ${today.toLocaleDateString()}`, pageWidth / 2, pageHeight - 25, { align: 'center' });

    doc.save(`Proposal_${proposal.town_name.replace(/\s+/g, '_')}_${billingYear}.pdf`);
    setSuccessMessage('Proposal PDF generated');
    setTimeout(() => setSuccessMessage(''), 3000);
  }, [billingYear]);

  const billingStatusOptions = [
    { value: 'open', label: 'Open', color: '#854d0e', bg: '#fef9c3' },
    { value: 'sent', label: 'Sent', color: '#1e40af', bg: '#dbeafe' },
    { value: 'paid', label: 'Paid', color: '#166534', bg: '#dcfce7' }
  ];

  // Filtered organizations for display
  const displayOrganizations = useMemo(() => {
    if (!showOpenOnly) return organizations;
    return organizations.filter(org => {
      const status = getBillingStatus(org);
      return status === 'open' || status === 'sent';
    });
  }, [organizations, showOpenOnly]);

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

      {/* View Open Invoices Toggle */}
      <div className="revenue-open-filter">
        <button
          className={`revenue-open-filter-btn ${showOpenOnly ? 'revenue-open-filter-active' : ''}`}
          onClick={() => setShowOpenOnly(prev => !prev)}
        >
          {showOpenOnly ? 'Show All Clients' : `View Open Invoices (${revenueSummary.openCount + revenueSummary.sentCount})`}
        </button>
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
              <th>Status</th>
              <th>Age</th>
              <th className="revenue-col-right">Annual Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayOrganizations.map(org => {
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
                  <td style={{ position: 'relative' }}>
                    {billingStatus === 'free' ? (
                      <span className="revenue-billing-badge revenue-billing-free">Free</span>
                    ) : (
                      <div style={{ position: 'relative', display: 'inline-block' }} ref={isDropdownOpen ? statusDropdownRef : null}>
                        <button
                          className={`revenue-billing-badge revenue-billing-${billingStatus} revenue-status-btn`}
                          onClick={() => setOpenStatusDropdown(isDropdownOpen ? null : org.id)}
                          title="Click to change status"
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
                  <td>
                    {(() => {
                      const age = getInvoiceAge(org);
                      if (age === null) return <span style={{ color: '#94a3b8' }}>-</span>;
                      return (
                        <span style={{ color: getAgingColor(age), fontWeight: age >= 60 ? '700' : '500', fontSize: '0.85rem' }}>
                          {age}d
                        </span>
                      );
                    })()}
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

      {/* Proposals Section */}
      <div className="revenue-proposals-section">
        <div className="revenue-proposals-header">
          <h3>Proposals</h3>
          <button
            className="revenue-create-proposal-btn"
            onClick={() => { resetProposalForm(); setShowProposalModal(true); }}
          >
            + New Proposal
          </button>
        </div>

        {proposals.length === 0 ? (
          <div className="revenue-proposals-empty">No proposals yet. Click "+ New Proposal" to create one.</div>
        ) : (
          <div className="revenue-table-wrapper">
            <table className="revenue-table">
              <thead>
                <tr>
                  <th>Town</th>
                  <th>Assessor</th>
                  <th>Email</th>
                  <th className="revenue-col-right">Proposed Price</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => (
                  <tr key={p.id} className={p.status === 'accepted' ? 'revenue-row-accepted' : ''}>
                    <td>
                      <div className="revenue-client-name">{p.town_name}</div>
                    </td>
                    <td>{p.assessor_name || '-'}</td>
                    <td>{p.email || '-'}</td>
                    <td className="revenue-col-right revenue-total-cell">
                      ${parseFloat(p.proposed_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>
                      <select
                        className={`revenue-proposal-status revenue-proposal-${p.status}`}
                        value={p.status}
                        onChange={(e) => handleProposalStatusChange(p.id, e.target.value)}
                        disabled={p.status === 'accepted'}
                      >
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="accepted">Accepted</option>
                        <option value="declined">Declined</option>
                      </select>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="revenue-pdf-btn" onClick={() => generateProposalPDF(p)} title="Generate Proposal PDF">PDF</button>
                        <button
                          className="revenue-pdf-btn"
                          style={{ background: '#6b7280' }}
                          onClick={() => {
                            setEditingProposal(p);
                            setProposalForm({
                              town_name: p.town_name, assessor_name: p.assessor_name || '',
                      address: p.address || '', email: p.email || '',
                      line_items: '', users: '1',
                      proposed_price: p.proposed_price, notes: p.notes || ''
                            });
                            setShowProposalModal(true);
                          }}
                          title="Edit proposal"
                        >Edit</button>
                        {p.status !== 'accepted' && (
                          <button
                            className="revenue-pdf-btn"
                            style={{ background: '#16a34a' }}
                            onClick={() => handleRolloverProposal(p)}
                            title="Onboard as client"
                          >Onboard</button>
                        )}
                        {p.status !== 'accepted' && (
                          <button
                            className="revenue-pdf-btn"
                            style={{ background: '#dc2626' }}
                            onClick={() => handleDeleteProposal(p.id)}
                            title="Delete proposal"
                          >Del</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Proposal Modal */}
      {showProposalModal && (
        <div className="revenue-modal-overlay" onClick={() => { setShowProposalModal(false); resetProposalForm(); }}>
          <div className="revenue-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '460px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="revenue-modal-header">
              <h3>{editingProposal ? 'Edit Proposal' : 'New Proposal'}</h3>
              <button className="revenue-modal-close" onClick={() => { setShowProposalModal(false); resetProposalForm(); }}>X</button>
            </div>
            <div className="revenue-modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <div className="revenue-form-group">
                <label>Town Name *</label>
                <input type="text" value={proposalForm.town_name} onChange={e => setProposalForm(prev => ({ ...prev, town_name: e.target.value }))} placeholder="e.g. Borough of Riverside" />
              </div>
              <div className="revenue-form-group">
                <label>Assessor Name</label>
                <input type="text" value={proposalForm.assessor_name} onChange={e => setProposalForm(prev => ({ ...prev, assessor_name: e.target.value }))} placeholder="e.g. John Smith" />
              </div>
              <div className="revenue-form-group">
                <label>Address</label>
                <textarea
                  value={proposalForm.address}
                  onChange={e => setProposalForm(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="123 Main St\nTownship, NJ 08000"
                  rows={2}
                  style={{ width: '100%', padding: '0.625rem 0.875rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div className="revenue-form-group">
                <label>Email Address</label>
                <input type="email" value={proposalForm.email} onChange={e => setProposalForm(prev => ({ ...prev, email: e.target.value }))} placeholder="assessor@township.gov" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="revenue-form-group">
                  <label>Est. Line Items</label>
                  <input type="number" min="0" value={proposalForm.line_items || ''} onChange={e => {
                    const lines = parseInt(e.target.value) || 0;
                    const users = parseInt(proposalForm.users) || 1;
                    const lineFee = calculateTieredLineItemFee(lines);
                    const userFee = priceConfig.primaryUserFee + Math.max(0, users - 1) * priceConfig.additionalUserFee;
                    setProposalForm(prev => ({ ...prev, line_items: e.target.value, proposed_price: (lineFee + userFee).toFixed(2) }));
                  }} placeholder="e.g. 5000" />
                </div>
                <div className="revenue-form-group">
                  <label>Users</label>
                  <input type="number" min="1" value={proposalForm.users || ''} onChange={e => {
                    const users = parseInt(e.target.value) || 1;
                    const lines = parseInt(proposalForm.line_items) || 0;
                    const lineFee = calculateTieredLineItemFee(lines);
                    const userFee = priceConfig.primaryUserFee + Math.max(0, users - 1) * priceConfig.additionalUserFee;
                    setProposalForm(prev => ({ ...prev, users: e.target.value, proposed_price: (lineFee + userFee).toFixed(2) }));
                  }} placeholder="1" />
                </div>
              </div>
              {(parseInt(proposalForm.line_items) > 0) && (
                <div className="revenue-config-preview" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ margin: '0 0 6px 0' }}>Price Breakdown</h4>
                  <p style={{ margin: '2px 0' }}>Line items: {parseInt(proposalForm.line_items).toLocaleString()} x ${getEffectiveRate(parseInt(proposalForm.line_items)).toFixed(2)} = ${calculateTieredLineItemFee(parseInt(proposalForm.line_items)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <p style={{ margin: '2px 0' }}>Primary user: ${priceConfig.primaryUserFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  {parseInt(proposalForm.users) > 1 && <p style={{ margin: '2px 0' }}>Add'l users ({parseInt(proposalForm.users) - 1}): ${(Math.max(0, (parseInt(proposalForm.users) || 1) - 1) * priceConfig.additionalUserFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>}
                </div>
              )}
              <div className="revenue-form-group">
                <label>Proposed Price ($) * {parseInt(proposalForm.line_items) > 0 ? '(auto-calculated, editable)' : ''}</label>
                <input type="number" step="0.01" min="0" value={proposalForm.proposed_price} onChange={e => setProposalForm(prev => ({ ...prev, proposed_price: e.target.value }))} placeholder="500.00" />
              </div>
              <div className="revenue-form-group">
                <label>Notes</label>
                <input type="text" value={proposalForm.notes} onChange={e => setProposalForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes" />
              </div>
            </div>
            <div className="revenue-modal-footer">
              <button className="revenue-modal-save" style={{ background: '#6b7280', marginRight: '8px' }} onClick={() => { setShowProposalModal(false); resetProposalForm(); }}>Cancel</button>
              <button className="revenue-modal-save" onClick={handleSaveProposal}>
                {editingProposal ? 'Update' : 'Create Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Configuration Modal */}
      {showInvoiceModal && (
        <div className="revenue-modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="revenue-modal" onClick={e => e.stopPropagation()}>
            <div className="revenue-modal-header">
              <h3>Pricing Configuration</h3>
              <button className="revenue-modal-close" onClick={() => setShowInvoiceModal(false)}>X</button>
            </div>
            <div className="revenue-modal-body">
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>Line Item Tiers</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.85rem', color: '#475569', fontWeight: '600', marginBottom: '4px' }}>
                  <span>Up To (lines)</span><span>Rate ($/line)</span>
                </div>
                {priceConfig.tiers.map((tier, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                    <input
                      type="text"
                      value={tier.maxLines === Infinity ? 'Unlimited' : tier.maxLines}
                      onChange={e => {
                        const val = e.target.value.toLowerCase() === 'unlimited' ? Infinity : parseInt(e.target.value) || 0;
                        setPriceConfig(prev => {
                          const tiers = [...prev.tiers];
                          tiers[i] = { ...tiers[i], maxLines: val };
                          return { ...prev, tiers };
                        });
                      }}
                      style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem' }}
                    />
                    <input
                      type="number" step="0.01" min="0"
                      value={tier.rate}
                      onChange={e => {
                        setPriceConfig(prev => {
                          const tiers = [...prev.tiers];
                          tiers[i] = { ...tiers[i], rate: parseFloat(e.target.value) || 0 };
                          return { ...prev, tiers };
                        });
                      }}
                      style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem' }}
                    />
                  </div>
                ))}
              </div>
              <div className="revenue-form-group">
                <label>Primary User Fee ($)</label>
                <input
                  type="number" step="1" min="0"
                  value={priceConfig.primaryUserFee}
                  onChange={e => setPriceConfig(prev => ({ ...prev, primaryUserFee: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="revenue-form-group">
                <label>Additional User Fee ($)</label>
                <input
                  type="number" step="1" min="0"
                  value={priceConfig.additionalUserFee}
                  onChange={e => setPriceConfig(prev => ({ ...prev, additionalUserFee: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="revenue-config-preview">
                <h4>Example Pricing</h4>
                <p>1,000 lines + 1 user: ${(calculateTieredLineItemFee(1000) + priceConfig.primaryUserFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p>5,000 lines + 1 user: ${(calculateTieredLineItemFee(5000) + priceConfig.primaryUserFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p>15,000 lines + 1 user: ${(calculateTieredLineItemFee(15000) + priceConfig.primaryUserFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
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
