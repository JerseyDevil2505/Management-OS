import React, { useState, useEffect, useRef } from 'react';
import { supabase, jobService, propertyService } from '../lib/supabaseClient';

const AssessorDashboard = ({ user, onJobSelect, onDataUpdate }) => {
  const [orgJobs, setOrgJobs] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

  // File upload state
  const [sourceFile, setSourceFile] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  const [fileAnalysis, setFileAnalysis] = useState({
    sourceFile: null,
    codeFile: null,
    propertyCount: 0,
    codeCount: 0,
    detectedVendor: null,
    isValid: false
  });

  // Job setup form
  const [jobForm, setJobForm] = useState({
    dueDate: '',
    name: '',
    municipality: '',
    county: '',
    ccddCode: '',
    isReassessment: false
  });

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    step: '',
    progress: 0,
    logs: []
  });
  const [processingComplete, setProcessingComplete] = useState(false);
  const [processingResult, setProcessingResult] = useState(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    loadAssessorData();
  }, [user]);

  const loadAssessorData = async () => {
    try {
      setLoading(true);
      const orgId = user?.employeeData?.organization_id;
      if (!orgId) {
        setLoading(false);
        return;
      }

      // Load organization details
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (org) {
        setOrganization(org);
        // Pre-fill form from org data
        setJobForm(prev => ({
          ...prev,
          municipality: org.name || '',
          name: `${org.name} ${new Date().getFullYear()}`
        }));
      }

      // Load jobs for this organization
      const { data: jobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      setOrgJobs(jobs || []);

      // If single_job_mode and has a job, go straight to it
      if (org?.single_job_mode && jobs?.length > 0) {
        const job = jobs[0];
        onJobSelect({
          id: job.id,
          name: job.job_name,
          job_name: job.job_name,
          municipality: job.municipality,
          county: job.county,
          vendor: job.vendor_type,
          ccddCode: job.ccdd_code,
          totalProperties: job.total_properties || 0
        });
        return;
      }

      // Show setup if no jobs exist
      if (!jobs || jobs.length === 0) {
        setShowSetup(true);
      }
    } catch (err) {
      console.error('Error loading assessor data:', err);
    } finally {
      setLoading(false);
    }
  };

  // File analysis - replicates AdminJobManagement logic
  const analyzeFile = async (file, type) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    let vendor = null;
    let count = 0;

    if (type === 'source') {
      if (file.name.endsWith('.txt') && text.includes('|')) {
        vendor = 'Microsystems';
        count = lines.length - 1;
      } else if (file.name.endsWith('.csv')) {
        vendor = 'BRT';
        count = lines.length - 1;
      }
    } else if (type === 'code') {
      if (file.name.endsWith('.txt') && text.includes('=')) {
        vendor = 'Microsystems';
        count = lines.length;
      } else if (text.includes('{')) {
        vendor = 'BRT';
        count = (text.match(/"VALUE":/g) || []).length;
      }
    }

    setFileAnalysis(prev => ({
      ...prev,
      [type === 'source' ? 'sourceFile' : 'codeFile']: file,
      [type === 'source' ? 'propertyCount' : 'codeCount']: count,
      detectedVendor: vendor || prev.detectedVendor,
      isValid: !!(vendor || prev.detectedVendor)
    }));
  };

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      if (type === 'source') setSourceFile(file);
      else setCodeFile(file);
      analyzeFile(file, type);
    }
  };

  const removeFile = (type) => {
    if (type === 'source') {
      setSourceFile(null);
      setFileAnalysis(prev => ({
        ...prev,
        sourceFile: null,
        propertyCount: 0,
        detectedVendor: prev.codeFile ? prev.detectedVendor : null,
        isValid: !!prev.codeFile
      }));
    } else {
      setCodeFile(null);
      setFileAnalysis(prev => ({
        ...prev,
        codeFile: null,
        codeCount: 0
      }));
    }
    const inputId = type === 'source' ? 'assessorSourceFile' : 'assessorCodeFile';
    const fileInput = document.getElementById(inputId);
    if (fileInput) fileInput.value = '';
  };

  const capitalizeCounty = (county) => {
    if (!county) return '';
    return county.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };

  const createAssessorJob = async () => {
    if (!jobForm.ccddCode || !jobForm.name || !jobForm.municipality) {
      alert('Please fill in all required fields (CCDD Code, Job Name, Municipality).');
      return;
    }
    if (jobForm.isReassessment && !jobForm.dueDate) {
      alert('Please enter a due date for your reassessment/revaluation.');
      return;
    }
    if (!sourceFile || !codeFile) {
      alert('Please upload both the Property Data File and Code Definitions File.');
      return;
    }
    if (processing) return;

    try {
      setProcessing(true);
      setProcessingComplete(false);
      setProcessingResult(null);
      setProcessingStatus({ step: 'Creating job record...', progress: 10, logs: [] });

      // If not a reassessment, default end_date to Dec 31 of current year
      const effectiveDueDate = jobForm.isReassessment && jobForm.dueDate
        ? jobForm.dueDate
        : `${new Date().getFullYear()}-12-31`;
      const assessmentYear = parseInt(effectiveDueDate.split('-')[0]);
      const startDate = `${assessmentYear}-01-01`;

      const jobData = {
        name: jobForm.name,
        ccdd: jobForm.ccddCode,
        municipality: jobForm.municipality,
        county: capitalizeCounty(jobForm.county),
        state: 'NJ',
        vendor: fileAnalysis.detectedVendor,
        dueDate: effectiveDueDate,
        createdDate: startDate,
        assignedManagers: [],
        totalProperties: fileAnalysis.propertyCount,
        status: 'active',
        sourceFileStatus: 'processing',
        codeFileStatus: 'current',
        vendorDetection: { vendor: fileAnalysis.detectedVendor },
        percent_billed: 0,
        source_file_version: 1,
        code_file_version: 1,
        source_file_name: sourceFile.name,
        source_file_version_id: crypto.randomUUID(),
        source_file_uploaded_at: new Date().toISOString(),
        workflowStats: {
          inspectionPhases: { firstAttempt: 'PENDING', secondAttempt: 'PENDING', thirdAttempt: 'PENDING' },
          rates: { entryRate: 0, refusalRate: 0, pricingRate: 0, commercialInspectionRate: 0 },
          appeals: { totalCount: 0, percentOfWhole: 0, byClass: {} }
        },
        created_by: user?.id
      };

      const createdJob = await jobService.create(jobData);

      // Link job to organization and pre-fill assessor contact from org
      if (organization?.id) {
        const jobUpdate = { organization_id: organization.id };
        if (organization.primary_contact_name) {
          jobUpdate.assessor_name = organization.primary_contact_name;
        }
        if (organization.primary_contact_email) {
          jobUpdate.assessor_email = organization.primary_contact_email;
        }
        await supabase
          .from('jobs')
          .update(jobUpdate)
          .eq('id', createdJob.id);
      }

      if (!isMountedRef.current) return;
      setProcessingStatus({ step: 'Reading files...', progress: 30, logs: [] });

      const sourceFileContent = await sourceFile.text();
      const codeFileContent = await codeFile.text();

      setProcessingStatus({
        step: `Processing ${fileAnalysis.detectedVendor} data (${fileAnalysis.propertyCount.toLocaleString()} records)...`,
        progress: 50,
        logs: []
      });

      const result = await propertyService.importCSVData(
        sourceFileContent,
        codeFileContent,
        createdJob.id,
        assessmentYear,
        jobForm.ccddCode,
        fileAnalysis.detectedVendor,
        {
          source_file_name: sourceFile.name,
          source_file_version_id: createdJob.source_file_version_id,
          source_file_uploaded_at: new Date().toISOString()
        }
      );

      if (result && result.error && (result.error.includes('cleaned up') || result.error.includes('Job creation failed'))) {
        try { await jobService.delete(createdJob.id); } catch (e) { /* */ }
        setProcessingResult({ success: false, error: result.error });
        setProcessingComplete(true);
        return;
      }

      // Update job status
      await jobService.update(createdJob.id, {
        sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
        totalProperties: result.processed || 0
      });

      // Update organization line_item_count
      if (organization?.id && result.processed) {
        await supabase
          .from('organizations')
          .update({ line_item_count: result.processed })
          .eq('id', organization.id);
      }

      setProcessingStatus({ step: 'Complete!', progress: 100, logs: [] });
      setProcessingResult({
        success: true,
        processed: result.processed || 0,
        errors: result.errors || 0,
        jobId: createdJob.id,
        jobName: jobForm.name
      });
      setProcessingComplete(true);

      // Reload jobs
      await loadAssessorData();
      if (onDataUpdate) onDataUpdate('jobs');

    } catch (error) {
      console.error('Job creation error:', error);
      setProcessingResult({ success: false, error: error.message });
      setProcessingComplete(true);
    } finally {
      setProcessing(false);
    }
  };

  const handleJobClick = (job) => {
    onJobSelect({
      id: job.id,
      name: job.job_name,
      job_name: job.job_name,
      municipality: job.municipality,
      county: job.county,
      vendor: job.vendor_type,
      ccddCode: job.ccdd_code,
      totalProperties: job.total_properties || 0
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px', height: '48px', border: '3px solid #e5e7eb', borderTopColor: '#3b82f6',
            borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto'
          }} />
          <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Processing modal
  if (processing || (processingComplete && processingResult)) {
    return (
      <div style={{ maxWidth: '700px', margin: '40px auto', padding: '0 16px' }}>
        <div style={{
          background: 'white', borderRadius: '12px', padding: '32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb'
        }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '24px', color: '#1f2937' }}>
            {processingComplete ? (processingResult?.success ? 'Setup Complete' : 'Setup Failed') : 'Processing Your Data'}
          </h2>

          {!processingComplete && (
            <>
              <div style={{
                width: '100%', height: '12px', background: '#e5e7eb', borderRadius: '6px',
                overflow: 'hidden', marginBottom: '16px'
              }}>
                <div style={{
                  width: `${processingStatus.progress}%`, height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                  borderRadius: '6px', transition: 'width 0.5s ease'
                }} />
              </div>
              <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>{processingStatus.step}</p>
            </>
          )}

          {processingComplete && processingResult?.success && (
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
              padding: '20px', marginBottom: '20px'
            }}>
              <p style={{ color: '#166534', fontWeight: '600', fontSize: '1.1rem', marginBottom: '8px' }}>
                Your assessment job is ready.
              </p>
              <p style={{ color: '#15803d', fontSize: '0.95rem' }}>
                {processingResult.processed?.toLocaleString()} properties processed for {processingResult.jobName}.
              </p>
              {processingResult.errors > 0 && (
                <p style={{ color: '#b45309', fontSize: '0.875rem', marginTop: '8px' }}>
                  {processingResult.errors} warnings during processing.
                </p>
              )}
            </div>
          )}

          {processingComplete && !processingResult?.success && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              padding: '20px', marginBottom: '20px'
            }}>
              <p style={{ color: '#991b1b', fontWeight: '600', marginBottom: '8px' }}>
                There was a problem setting up your job.
              </p>
              <p style={{ color: '#b91c1c', fontSize: '0.875rem' }}>
                {processingResult?.error || 'An unexpected error occurred.'}
              </p>
            </div>
          )}

          {processingComplete && (
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              {!processingResult?.success && (
                <button
                  onClick={() => { setProcessingComplete(false); setProcessingResult(null); }}
                  style={{
                    padding: '10px 24px', borderRadius: '8px', fontWeight: '600',
                    background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', cursor: 'pointer'
                  }}
                >
                  Try Again
                </button>
              )}
              {processingResult?.success && (
                <button
                  onClick={() => {
                    const job = orgJobs.find(j => j.id === processingResult.jobId) || orgJobs[0];
                    if (job) handleJobClick(job);
                  }}
                  style={{
                    padding: '10px 24px', borderRadius: '8px', fontWeight: '600',
                    background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer'
                  }}
                >
                  Open Your Job
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
      {/* Welcome Header */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1f2937', marginBottom: '4px' }}>
          {organization?.name || 'Your Dashboard'}
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          {orgJobs.length > 0
            ? `You have ${orgJobs.length} assessment job${orgJobs.length > 1 ? 's' : ''}.`
            : 'Get started by uploading your property data.'}
        </p>
      </div>

      {/* Existing Jobs List */}
      {orgJobs.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#374151' }}>Your Jobs</h3>
            <button
              onClick={() => setShowSetup(true)}
              style={{
                padding: '8px 16px', borderRadius: '8px', fontWeight: '600', fontSize: '0.875rem',
                background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer'
              }}
            >
              + New Job
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {orgJobs.map(job => (
              <div
                key={job.id}
                onClick={() => handleJobClick(job)}
                style={{
                  background: 'white', borderRadius: '10px', padding: '20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb',
                  cursor: 'pointer', transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(59,130,246,0.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '1.05rem', color: '#1f2937' }}>
                      {job.job_name}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '4px' }}>
                      {job.municipality}{job.county ? `, ${job.county} County` : ''} &middot; {job.vendor_type || 'Unknown'} &middot; {(job.total_properties || 0).toLocaleString()} properties
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600',
                      background: job.status === 'active' ? '#dcfce7' : '#f3f4f6',
                      color: job.status === 'active' ? '#166534' : '#6b7280'
                    }}>
                      {(job.status || 'active').charAt(0).toUpperCase() + (job.status || 'active').slice(1)}
                    </span>
                    <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                      Due: {formatDate(job.end_date)}
                    </span>
                    <span style={{ color: '#3b82f6', fontWeight: '600', fontSize: '0.9rem' }}>Open →</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup / New Job Form */}
      {(showSetup || orgJobs.length === 0) && (
        <div style={{
          background: 'white', borderRadius: '12px', padding: '32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb'
        }}>
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.35rem', fontWeight: '700', color: '#1f2937', marginBottom: '4px' }}>
              {orgJobs.length > 0
                ? 'Create New Assessment Job'
                : organization?.single_job_mode
                  ? 'Set Up Your Municipality'
                  : 'Set Up Your Assessment'}
            </h3>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              Upload your property data and code definitions files to get started.
            </p>
          </div>

          {/* Job Information */}
          <div style={{
            background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
            padding: '20px', marginBottom: '24px'
          }}>
            <h4 style={{ fontWeight: '600', color: '#92400e', marginBottom: '16px', fontSize: '0.95rem' }}>
              Job Information
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                  CCDD Code *
                </label>
                <input
                  type="text"
                  value={jobForm.ccddCode}
                  onChange={e => setJobForm({ ...jobForm, ccddCode: e.target.value })}
                  placeholder="e.g., 0301"
                  maxLength="4"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px' }}>4-digit municipal code</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                  Job Name *
                </label>
                <input
                  type="text"
                  value={jobForm.name}
                  onChange={e => setJobForm({ ...jobForm, name: e.target.value })}
                  placeholder="e.g., Borough of Riverton 2025"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                  Municipality *
                </label>
                <input
                  type="text"
                  value={jobForm.municipality}
                  onChange={e => setJobForm({ ...jobForm, municipality: e.target.value })}
                  placeholder="e.g., Borough of Riverton"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                  County
                </label>
                <input
                  type="text"
                  value={jobForm.county}
                  onChange={e => setJobForm({ ...jobForm, county: e.target.value })}
                  placeholder="e.g., Burlington"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Reassessment toggle */}
            <div style={{ marginTop: '16px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                fontSize: '0.9rem', color: '#374151', fontWeight: '500'
              }}>
                <input
                  type="checkbox"
                  checked={jobForm.isReassessment}
                  onChange={e => setJobForm({ ...jobForm, isReassessment: e.target.checked, dueDate: e.target.checked ? jobForm.dueDate : '' })}
                  style={{ width: '18px', height: '18px', accentColor: '#2563eb', cursor: 'pointer' }}
                />
                This is a reassessment or revaluation
              </label>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px', marginLeft: '28px' }}>
                {jobForm.isReassessment
                  ? 'Enter the completion deadline for your reassessment.'
                  : `Assessment year will default to ${new Date().getFullYear()}.`}
              </p>
            </div>

            {jobForm.isReassessment && (
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                  Due Date *
                </label>
                <input
                  type="date"
                  value={jobForm.dueDate}
                  onChange={e => setJobForm({ ...jobForm, dueDate: e.target.value })}
                  style={{
                    width: '50%', padding: '8px 12px', borderRadius: '6px',
                    border: '1px solid #d1d5db', fontSize: '0.95rem', boxSizing: 'border-box'
                  }}
                />
              </div>
            )}
          </div>

          {/* File Upload Section */}
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px',
            padding: '20px', marginBottom: '24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <h4 style={{ fontWeight: '600', color: '#1e40af', fontSize: '0.95rem', margin: 0 }}>
                Upload Files
              </h4>
              {fileAnalysis.detectedVendor && (
                <span style={{
                  padding: '3px 10px', background: '#dcfce7', color: '#166534',
                  borderRadius: '20px', fontSize: '0.75rem', fontWeight: '600'
                }}>
                  {fileAnalysis.detectedVendor} Detected
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Source Data File */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#1e40af', marginBottom: '8px' }}>
                  Property Data File *
                </label>
                <div style={{
                  border: '2px dashed #93c5fd', borderRadius: '8px', padding: '24px',
                  textAlign: 'center', background: 'white', cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.background = 'white'; }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = '#93c5fd';
                    e.currentTarget.style.background = 'white';
                    const file = e.dataTransfer.files[0];
                    if (file) { setSourceFile(file); analyzeFile(file, 'source'); }
                  }}
                >
                  <input
                    type="file"
                    accept=".txt,.csv,.xlsx"
                    onChange={e => handleFileUpload(e, 'source')}
                    style={{ display: 'none' }}
                    id="assessorSourceFile"
                  />
                  <label htmlFor="assessorSourceFile" style={{ cursor: 'pointer' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📄</div>
                    <div style={{ fontWeight: '600', color: '#2563eb', fontSize: '0.9rem' }}>Source Data File</div>
                    <div style={{ color: '#60a5fa', fontSize: '0.8rem', marginTop: '4px' }}>
                      .txt (Microsystems) or .csv (BRT)
                    </div>
                  </label>
                </div>
                {fileAnalysis.sourceFile && (
                  <div style={{
                    marginTop: '12px', padding: '12px', background: 'white',
                    borderRadius: '6px', border: '1px solid #d1d5db', position: 'relative'
                  }}>
                    <button
                      onClick={() => removeFile('source')}
                      style={{
                        position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px',
                        background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%',
                        cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >X</button>
                    <div style={{ fontWeight: '600', color: '#166534', fontSize: '0.9rem', marginBottom: '4px' }}>
                      {fileAnalysis.detectedVendor} Format Detected
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#374151' }}>{fileAnalysis.sourceFile.name}</div>
                    {fileAnalysis.propertyCount > 0 && (
                      <div style={{ fontWeight: '600', color: '#16a34a', fontSize: '0.85rem', marginTop: '4px' }}>
                        {fileAnalysis.propertyCount.toLocaleString()} properties
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Code Definitions File */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#1e40af', marginBottom: '8px' }}>
                  Code Definitions File *
                </label>
                <div style={{
                  border: '2px dashed #93c5fd', borderRadius: '8px', padding: '24px',
                  textAlign: 'center', background: 'white', cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#eff6ff'; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.background = 'white'; }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = '#93c5fd';
                    e.currentTarget.style.background = 'white';
                    const file = e.dataTransfer.files[0];
                    if (file) { setCodeFile(file); analyzeFile(file, 'code'); }
                  }}
                >
                  <input
                    type="file"
                    accept=".txt,.json"
                    onChange={e => handleFileUpload(e, 'code')}
                    style={{ display: 'none' }}
                    id="assessorCodeFile"
                  />
                  <label htmlFor="assessorCodeFile" style={{ cursor: 'pointer' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📋</div>
                    <div style={{ fontWeight: '600', color: '#2563eb', fontSize: '0.9rem' }}>Code Definitions File</div>
                    <div style={{ color: '#60a5fa', fontSize: '0.8rem', marginTop: '4px' }}>
                      .txt (Microsystems) or .txt/.json (BRT)
                    </div>
                  </label>
                </div>
                {fileAnalysis.codeFile && (
                  <div style={{
                    marginTop: '12px', padding: '12px', background: 'white',
                    borderRadius: '6px', border: '1px solid #d1d5db', position: 'relative'
                  }}>
                    <button
                      onClick={() => removeFile('code')}
                      style={{
                        position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px',
                        background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%',
                        cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >X</button>
                    <div style={{ fontWeight: '600', color: '#166534', fontSize: '0.9rem', marginBottom: '4px' }}>
                      Code file loaded
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#374151' }}>{fileAnalysis.codeFile.name}</div>
                    {fileAnalysis.codeCount > 0 && (
                      <div style={{ fontWeight: '600', color: '#16a34a', fontSize: '0.85rem', marginTop: '4px' }}>
                        {fileAnalysis.codeCount.toLocaleString()} code definitions
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {orgJobs.length > 0 && (
              <button
                onClick={() => setShowSetup(false)}
                style={{
                  padding: '10px 20px', borderRadius: '8px', fontWeight: '600',
                  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={createAssessorJob}
                disabled={processing || !fileAnalysis.sourceFile || !fileAnalysis.codeFile || !jobForm.ccddCode || !jobForm.name || !jobForm.municipality || !jobForm.dueDate}
                style={{
                  padding: '12px 32px', borderRadius: '8px', fontWeight: '700', fontSize: '1rem',
                  background: (fileAnalysis.sourceFile && fileAnalysis.codeFile && jobForm.ccddCode && jobForm.name && jobForm.municipality && jobForm.dueDate)
                    ? '#2563eb' : '#9ca3af',
                  color: 'white', border: 'none', cursor: 'pointer',
                  opacity: processing ? 0.6 : 1
                }}
              >
                {processing ? 'Processing...' : 'Create Job & Process Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssessorDashboard;
