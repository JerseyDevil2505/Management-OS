import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle, Clock, AlertCircle, Users, Calendar, FileText, Settings, Database, 
  Plus, Edit3, Trash2, ArrowLeft, Download, Upload, Filter, Search, Eye, UserCheck, 
  Building, MapPin, Mail, FileCheck, Target, ExternalLink, FileUp, CheckSquare, 
  Square, FileDown, Printer, Archive, Save, X, XCircle, ArrowRight
} from 'lucide-react';
import { supabase, checklistService } from '../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const ManagementChecklist = ({ jobData, onBackToJobs, activeSubModule = 'checklist', onSubModuleChange, properties = [], inspectionData = [], onJobUpdate }) => {
  const [editableAssessorName, setEditableAssessorName] = useState(jobData?.assessor_name || '');
  const [editableAssessorEmail, setEditableAssessorEmail] = useState(jobData?.assessor_email || '');
  const [editableYearOfValue, setEditableYearOfValue] = useState(jobData?.year_of_value || '');
  const [hasAssessorNameChanges, setHasAssessorNameChanges] = useState(false);
  const [checklistType, setChecklistType] = useState(jobData?.project_type || 'revaluation');
  const [hasAssessorEmailChanges, setHasAssessorEmailChanges] = useState(false);
  const [hasYearOfValueChanges, setHasYearOfValueChanges] = useState(false);
  const [checklistItems, setChecklistItems] = useState([]);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [uploadingItems, setUploadingItems] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [validFiles, setValidFiles] = useState({}); // Track which files actually exist
  const [checklistDocuments, setChecklistDocuments] = useState({}); // Track multiple documents per item
  const [generatingLists, setGeneratingLists] = useState({
    initial: false,
    second: false,
    third: false
  }); // Separate loading states for each list
  const [processingApprovals, setProcessingApprovals] = useState({}); // Track which approvals are being processed

  // Extract year from end_date - just grab first 4 characters to avoid timezone issues
  const dueYear = jobData?.end_date ? jobData.end_date.substring(0, 4) : 'TBD';
  
  // Format dates from database
  const formatDate = (dateString) => {
    if (!dateString) return 'Not available';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch (error) {
      return 'Invalid date';
    }
  };

useEffect(() => {
    // Use job data from props instead of loading from database
    if (jobData) {
      // Scroll to top when component loads
      window.scrollTo(0, 0);
      
      // Set values from the jobData prop
      setEditableAssessorName(jobData.assessor_name || '');
      setEditableAssessorEmail(jobData.assessor_email || '');
      setEditableYearOfValue(jobData.year_of_value || '');
      setChecklistType(jobData.project_type || 'revaluation');
    }
  }, [jobData]);

  useEffect(() => {
    if (jobData) {
      // Scroll to top when checklist items are loaded
      window.scrollTo(0, 0);
      loadChecklistItems();
    }

    // Listen for external checklist updates (e.g., from components that mark items complete)
    const handler = (e) => {
      try {
        if (!e?.detail) return;
        if (e.detail.jobId && e.detail.jobId === jobData?.id) {
          loadChecklistItems();
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('checklist_status_changed', handler);

    return () => window.removeEventListener('checklist_status_changed', handler);
  }, [jobData, checklistType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if files actually exist in storage
  const verifyFiles = async (items) => {
    const fileChecks = {};
    
    for (const item of items) {
      if (item.file_attachment_path) {
        try {
          // Check if file exists in storage
          const { data, error } = await supabase.storage
            .from('checklist-documents')
            .list(jobData.id, {
              limit: 100,
              search: item.file_attachment_path.split('/').pop()
            });
          
          if (!error && data && data.length > 0) {
            fileChecks[item.id] = true;
          } else {
            fileChecks[item.id] = false;
            // If file doesn't exist, clear it from the database
            await supabase
              .from('checklist_item_status')
              .update({ file_attachment_path: null })
              .eq('job_id', jobData.id)
              .eq('item_id', item.id);
          }
        } catch (err) {
          console.error('Error checking file:', err);
          fileChecks[item.id] = false;
        }
      }
    }
    
    setValidFiles(fileChecks);
  };

// Use property records from props instead of fetching
  const getAllPropertyRecords = async (jobId) => {
    console.log('📊 Using property records from props');
    
    // Use properties from component props
    if (!properties || properties.length === 0) {
      console.warn('Properties not passed from JobContainer');
      return [];
    }
    
    // Return only the fields we need for mailing lists
    const mailingFields = properties.map(record => ({
      property_block: record.property_block,
      property_lot: record.property_lot,
      property_qualifier: record.property_qualifier,
      property_m4_class: record.property_m4_class,
      property_location: record.property_location,
      property_facility: record.property_facility,
      owner_name: record.owner_name,
      owner_street: record.owner_street,
      owner_csz: record.owner_csz,
      property_composite_key: record.property_composite_key,
      inspection_info_by: record.inspection_info_by
    }));
    
    console.log(`✅ Using ${mailingFields.length} property records from props`);
    return mailingFields;
  };
  // Use inspection data from props instead of fetching
  const getAllInspectionData = async (jobId) => {
    console.log('🔍 Using inspection data from props');
    
    // Use inspectionData from component props
    if (!inspectionData || inspectionData.length === 0) {
      console.warn('Inspection data not passed from JobContainer - ProductionTracker may need to run first');
      return [];
    }
    
    // Return only the fields we need for mailer lists
    const inspectionFields = inspectionData.map(record => ({
      block: record.block,
      lot: record.lot,
      qualifier: record.qualifier,
      property_composite_key: record.property_composite_key,
      info_by_code: record.info_by_code,
      list_by: record.list_by,
      measure_date: record.measure_date,
      list_date: record.list_date
    }));
    
    console.log(`✅ Using ${inspectionFields.length} inspection records from props`);
    return inspectionFields;
  };

  // Define the checklist template locally in code
  const CHECKLIST_TEMPLATE = [
    { id: 'contract-signed-client', item_text: 'Contract Signed by Client', item_order: 1, category: 'setup', requires_client_approval: false, allows_file_upload: true },
    { id: 'contract-signed-state', item_text: 'Contract Signed/Approved by State', item_order: 2, category: 'setup', requires_client_approval: false, allows_file_upload: true },
    { id: 'tax-maps-approved', item_text: 'Tax Maps Approved', item_order: 3, category: 'setup', requires_client_approval: false, allows_file_upload: false },
    { id: 'tax-map-upload', item_text: 'Tax Map Upload', item_order: 4, category: 'setup', requires_client_approval: false, allows_file_upload: true },
    { id: 'zoning-map-upload', item_text: 'Zoning Map Upload', item_order: 5, category: 'setup', requires_client_approval: false, allows_file_upload: true },
    { id: 'zoning-regulations-upload', item_text: 'Zoning Bulk and Use Regulations Upload', item_order: 6, category: 'setup', requires_client_approval: false, allows_file_upload: true },
    { id: 'ppa-website-updated', item_text: 'PPA Website Updated', item_order: 7, category: 'setup', requires_client_approval: false, allows_file_upload: false },
    { id: 'data-collection-params', item_text: 'Data Collection Parameters', item_order: 8, category: 'setup', requires_client_approval: true, allows_file_upload: false },
    { id: 'initial-mailing-list', item_text: 'Initial Mailing List', item_order: 9, category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_mailing_list' },
    { id: 'initial-letter-brochure', item_text: 'Initial Letter and Brochure', item_order: 10, category: 'inspection', requires_client_approval: false, allows_file_upload: true },
    { id: 'initial-mailing-sent', item_text: 'Initial Mailing Sent', item_order: 11, category: 'inspection', requires_client_approval: false, allows_file_upload: false },
    { id: 'first-attempt', item_text: 'First Attempt Inspections', item_order: 12, category: 'inspection', requires_client_approval: false, allows_file_upload: false },
    { id: 'second-attempt', item_text: 'Second Attempt Inspections', item_order: 13, category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_second_attempt_mailer' },
    { id: 'third-attempt', item_text: 'Third Attempt Inspections', item_order: 14, category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_third_attempt_mailer' },
    { id: 'lot-sizing', item_text: 'Lot Sizing Completed', item_order: 15, category: 'inspection', requires_client_approval: false, allows_file_upload: false },
    { id: 'lot-sizing-questions', item_text: 'Lot Sizing Questions Complete', item_order: 16, category: 'inspection', requires_client_approval: false, allows_file_upload: false },
    { id: 'data-quality-analysis', item_text: 'Data Quality Analysis', item_order: 17, category: 'analysis', requires_client_approval: false, allows_file_upload: false },
    { id: 'market-analysis', item_text: 'Market Analysis', item_order: 18, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'page-by-page', item_text: 'Page by Page Analysis', item_order: 19, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'land-value-tables', item_text: 'Land Value Tables Built', item_order: 20, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'land-values-entered', item_text: 'Land Values Entered', item_order: 21, category: 'analysis', requires_client_approval: true, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'economic-obsolescence', item_text: 'Economic Obsolescence Study', item_order: 22, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'vcs-reviewed', item_text: 'VCS Reviewed/Reset', item_order: 23, category: 'analysis', requires_client_approval: true, allows_file_upload: false },
    { id: 'cost-conversion', item_text: 'Cost Conversion Factor Set', item_order: 24, category: 'analysis', requires_client_approval: true, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'building-class-review', item_text: 'Building Class Review/Updated', item_order: 25, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'effective-age', item_text: 'Effective Age Loaded/Set', item_order: 26, category: 'analysis', requires_client_approval: false, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'final-values', item_text: 'Final Values Ready', item_order: 27, category: 'completion', requires_client_approval: true, allows_file_upload: false, is_analysis_item: true, sync_from_component: true },
    { id: 'turnover-document', item_text: 'Generate Turnover Document', item_order: 28, category: 'completion', requires_client_approval: false, allows_file_upload: true },
    { id: 'turnover-date', item_text: 'Turnover Date', item_order: 29, category: 'completion', requires_client_approval: false, allows_file_upload: false, input_type: 'date', special_action: 'archive_trigger' }
  ];

  // Load checklist items from props or initialize
  const loadChecklistItems = async () => {
    try {
      setIsLoadingItems(true);
     
      // Load the status data from the database (what's been completed, approved, etc.)
      const { data: statusData, error: statusError } = await supabase
        .from('checklist_item_status')
        .select('*')
        .eq('job_id', jobData.id);
      
      if (statusError) {
        console.error('Error loading checklist status:', statusError);
      }
      
      // Create a map of status data by item_id
      const statusMap = new Map();
      if (statusData) {
        statusData.forEach(status => {
          statusMap.set(status.item_id, status);
        });
      }
      
      // Merge template with status data
      const items = CHECKLIST_TEMPLATE.map(templateItem => {
        const status = statusMap.get(templateItem.id) || {};
        return {
          ...templateItem,
          status: status.status || 'pending',
          completed_at: status.completed_at,
          completed_by: status.completed_by,
          client_approved: status.client_approved || false,
          client_approved_date: status.client_approved_date,
          client_approved_by: status.client_approved_by,
          file_attachment_path: status.file_attachment_path
          // notes column deleted from schema
        };
      });
      
      // Load all documents for items that can have multiple files
      const { data: documents, error: docsError } = await supabase
        .from('checklist_documents')
        .select('*')
        .eq('job_id', jobData.id);
      
      if (!docsError && documents) {
        // Group documents by checklist item
        const docsByItem = documents.reduce((acc, doc) => {
          if (!acc[doc.checklist_item_id]) {
            acc[doc.checklist_item_id] = [];
          }
          acc[doc.checklist_item_id].push(doc);
          return acc;
        }, {});
        setChecklistDocuments(docsByItem);
      }
      
      // Update First Attempt Inspections item with workflow stats if available
      if (jobData?.workflow_stats?.validInspections) {
        const firstAttemptItem = items.find(item => item.item_text === 'First Attempt Inspections');
        if (firstAttemptItem) {
          firstAttemptItem.notes = `${jobData.workflow_stats.validInspections} properties inspected (${jobData.workflow_stats.jobEntryRate?.toFixed(1) || 0}% entry rate)`;
          if (jobData.workflow_stats.validInspections > 0 && firstAttemptItem.status === 'pending') {
            firstAttemptItem.status = 'in_progress';
          }
        }
      }
      
      setChecklistItems(items);
      
      // Verify which files actually exist
      await verifyFiles(items);

    } catch (error) {
      console.error('Error loading checklist items:', error);
      setChecklistItems([]);
    } finally {
      setIsLoadingItems(false);
    }
  };

  useEffect(() => {
    setHasAssessorNameChanges(editableAssessorName !== jobData?.assessor_name);
  }, [editableAssessorName, jobData?.assessor_name]);

  useEffect(() => {
    setHasAssessorEmailChanges(editableAssessorEmail !== jobData?.assessor_email);
  }, [editableAssessorEmail, jobData?.assessor_email]);

  useEffect(() => {
    const currentVal = jobData?.year_of_value ? String(jobData.year_of_value) : '';
    setHasYearOfValueChanges(String(editableYearOfValue) !== currentVal);
  }, [editableYearOfValue, jobData?.year_of_value]);

  const saveYearOfValue = async () => {
    try {
      const yearVal = editableYearOfValue ? parseInt(editableYearOfValue) : null;
      if (onJobUpdate) {
        await onJobUpdate({ year_of_value: yearVal });
      } else {
        await supabase
          .from('jobs')
          .update({ year_of_value: yearVal })
          .eq('id', jobData.id);
      }
      setHasYearOfValueChanges(false);
    } catch (err) {
      console.error('Error saving year of value:', err);
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'setup': return Building;
      case 'inspection': return Eye;
      case 'analysis': return Target;
      case 'completion': return CheckCircle;
      default: return FileText;
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'setup': return 'blue';
      case 'inspection': return 'green';
      case 'analysis': return 'purple';
      case 'completion': return 'orange';
      default: return 'gray';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'green';
      case 'in_progress': return 'yellow';
      case 'pending': return 'gray';
      case 'skipped': return 'red';
      default: return 'gray';
    }
  };

  const filteredItems = checklistItems.filter(item => {
    const matchesCategory = filterCategory === 'all' || item.category === filterCategory;
    const matchesSearch = item.item_text.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCompleted = showCompleted || item.status !== 'completed';
    return matchesCategory && matchesSearch && matchesCompleted;
  }).sort((a, b) => a.item_order - b.item_order);

// For reassessment, exclude analysis and completion items from counts
  const applicableItems = checklistType === 'reassessment' 
    ? checklistItems.filter(item => item.category !== 'analysis' && item.category !== 'completion')
    : checklistItems;
  
  const completedCount = applicableItems.filter(item => item.status === 'completed').length;
  const totalCount = applicableItems.length;
  const completionPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleItemStatusChange = async (itemId, newStatus) => {
    try {
      // Save to checklist_item_status table (upsert)
      const { error } = await supabase
        .from('checklist_item_status')
        .upsert({
          job_id: jobData.id,
          item_id: itemId,
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
          completed_by: newStatus === 'completed' ? (currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad') : null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id,item_id'
        });
      
      if (error) throw error;
      
      // Update local state
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? { 
          ...item, 
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
          completed_by: newStatus === 'completed' ? (currentUser?.name || 'Jim Duda') : null
        } : item
      ));

    } catch (error) {
      console.error('Error updating item status:', error);
      alert('Failed to update status. Please try again.');
    }
  };

  const handleClientApproval = async (itemId, approved) => {
    try {
      // Set processing state to prevent double-clicks
      setProcessingApprovals(prev => ({ ...prev, [itemId]: true }));
      
      console.log(`Client approval change for item ${itemId}: ${approved ? 'APPROVED' : 'NOT APPROVED'}`);
      
      // Save to checklist_item_status table (upsert)
      const { error } = await supabase
        .from('checklist_item_status')
        .upsert({
          job_id: jobData.id,
          item_id: itemId,
          client_approved: approved,
          client_approved_date: approved ? new Date().toISOString() : null,
          client_approved_by: approved ? (currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad') : null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id,item_id'
        });
      
      if (error) throw error;
      
      // Update local state
      setChecklistItems(items => items.map(item =>
        item.id === itemId ? {
          ...item,
          client_approved: approved,
          client_approved_date: approved ? new Date().toISOString() : null,
          client_approved_by: approved ? (currentUser?.name || 'Jim Duda') : null
        } : item
      ));

      // Auto-mark as complete when client approves
      if (approved) {
        await handleItemStatusChange(itemId, 'completed');
      }

    } catch (error) {
      console.error('Error updating client approval:', error);
      alert('Failed to update approval. Please try again.');
    } finally {
      // Clear processing state
      setProcessingApprovals(prev => ({ ...prev, [itemId]: false }));
    }
  };

  // Direct file handler
  const handleFileSelect = async (itemId, itemText) => {
    console.log(`📁 Opening file selector for item: ${itemText} (ID: ${itemId})`);
    
    // Create file input programmatically
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg';
    fileInput.multiple = itemText === 'Initial Letter and Brochure'; // Allow multiple for this item
    
    fileInput.onchange = async (event) => {
      const files = Array.from(event.target.files);
      if (!files.length) return;
      
      // Handle multiple files for Initial Letter and Brochure
      if (itemText === 'Initial Letter and Brochure' && files.length > 1) {
        console.log(`📄 Multiple files selected for ${itemText}: ${files.map(f => f.name).join(', ')}`);
        
        // Check all file sizes
        const oversizedFile = files.find(file => file.size > 200 * 1024 * 1024);
        if (oversizedFile) {
          alert(`File ${oversizedFile.name} exceeds 200MB limit`);
          return;
        }
        
        setUploadingItems(prev => ({ ...prev, [itemId]: true }));
        
        try {
          console.log(`⬆️ Starting multiple file upload for item ${itemId}: ${itemText}`);
          
          // Upload files to storage bucket
          const uploadedPaths = [];
          for (const file of files) {
            const fileName = `${Date.now()}_${file.name}`;
            const filePath = `${jobData.id}/${itemId}/${fileName}`;
            
            const { data, error } = await supabase.storage
              .from('checklist-documents')
              .upload(filePath, file);
            
            if (error) throw error;
            
            uploadedPaths.push(filePath);
            
            // Save to checklist_documents table for multiple files
            await supabase
              .from('checklist_documents')
              .insert({
                job_id: jobData.id,
                checklist_item_id: itemId,
                file_path: filePath,
                file_name: file.name,
                uploaded_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad',
                uploaded_at: new Date().toISOString()
              });
          }
          
          console.log(`✅ All uploads complete for ${itemText}`);
          
          // Reload to show all files
          await loadChecklistItems();
          
          alert(`${files.length} files uploaded successfully!`);
          
        } catch (error) {
          console.error(`❌ Error uploading files for ${itemText}:`, error);
          alert('Failed to upload one or more files. Please try again.');
        } finally {
          setUploadingItems(prev => ({ ...prev, [itemId]: false }));
        }
      } else {
        // Single file upload
        const file = files[0];
        console.log(`📄 File selected for ${itemText}: ${file.name}`);
        
        if (file.size > 200 * 1024 * 1024) {
          alert('File size exceeds 200MB limit');
          return;
        }
        
        setUploadingItems(prev => ({ ...prev, [itemId]: true }));
        
        try {
          console.log(`⬆️ Starting upload for item ${itemId}: ${itemText}`);
          
          // Upload file to storage bucket
          const fileName = `${Date.now()}_${file.name}`;
          const filePath = `${jobData.id}/${itemId}/${fileName}`;
          
          const { data, error } = await supabase.storage
            .from('checklist-documents')
            .upload(filePath, file);
          
          if (error) throw error;
          
          console.log(`✅ Upload complete for ${itemText}`, filePath);
          
          // Update checklist_item_status table with file path
          await supabase
            .from('checklist_item_status')
            .upsert({
              job_id: jobData.id,
              item_id: itemId,
              file_attachment_path: filePath,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'job_id,item_id'
            });
          
          // Update local state
          setChecklistItems(items => items.map(item => 
            item.id === itemId ? { ...item, file_attachment_path: filePath } : item
          ));
          
          // Mark this file as valid
          setValidFiles(prev => ({ ...prev, [itemId]: true }));
          
          alert('File uploaded successfully!');
          
        } catch (error) {
          console.error(`❌ Error uploading file for ${itemText}:`, error);
          alert('Failed to upload file. Please try again.');
        } finally {
          setUploadingItems(prev => ({ ...prev, [itemId]: false }));
        }
      }
    };
    
    // Trigger file selection
    fileInput.click();
  };

  const saveAssessorName = async () => {
    try {
      // Use callback to parent instead of direct save
      if (onJobUpdate) {
        await onJobUpdate({ assessor_name: editableAssessorName });
      } else {
        // Fallback to direct save if no callback provided
        await supabase
          .from('jobs')
          .update({ assessor_name: editableAssessorName })
          .eq('id', jobData.id);
      }
      
      // Update local state
      setHasAssessorNameChanges(false);
      
      // Success feedback
      alert('Assessor name updated successfully!');
    } catch (error) {
      console.error('Error saving assessor name:', error);
      alert('Failed to save assessor name. Please try again.');
    }
  };

  const saveAssessorEmail = async () => {
    try {
      // Use callback to parent instead of direct save
      if (onJobUpdate) {
        await onJobUpdate({ assessor_email: editableAssessorEmail });
      } else {
        // Fallback to direct save if no callback provided
        await supabase
          .from('jobs')
          .update({ assessor_email: editableAssessorEmail })
          .eq('id', jobData.id);
      }
      
      // Update local state
      setHasAssessorEmailChanges(false);
      
      // Success feedback
      alert('Assessor email updated successfully!');
    } catch (error) {
      console.error('Error saving assessor email:', error);
      alert('Failed to save assessor email. Please try again.');
    }
  };

  // Helper function to parse City, State Zip from owner_csz
  const parseCityStateZip = (ownerCsz) => {
    if (!ownerCsz || ownerCsz.trim() === '') {
      return { cityState: '', zip: '' };
    }

    // Split by spaces and get the last part as zip
    const parts = ownerCsz.trim().split(/\s+/);
    const zip = parts[parts.length - 1];
    const cityState = parts.slice(0, -1).join(' ');

    return { cityState, zip };
  };

  // ENHANCED: Direct Excel download for Initial Mailing List
  const generateMailingListExcel = async () => {
    try {
      setGeneratingLists(prev => ({ ...prev, initial: true }));
      console.log('📊 Generating Initial Mailing List as Excel...');

      // Get ALL property records with pagination
      const mailingData = await getAllPropertyRecords(jobData.id);

      // Filter for residential properties and specific class 15s
      const filteredData = mailingData.filter(record => {
        const propClass = record.property_m4_class?.toUpperCase() || '';

        // Include residential classes
        if (['1', '2', '3A', '3B', '4A', '4B', '4C'].includes(propClass)) {
          return true;
        }

        // Include class 15 variants (15A, 15B, 15C, 15D, 15E, 15F) with specific facility names
        if (propClass.startsWith('15') && record.property_facility) {
          const facilityLower = record.property_facility.toLowerCase();
          return facilityLower.includes('residence') ||
                 facilityLower.includes('vet') ||
                 facilityLower.includes('veteran') ||
                 facilityLower.includes('widow') ||
                 facilityLower.includes('tdv');
        }

        return false;
      });

      console.log(`✅ Filtered to ${filteredData.length} residential properties`);

      // Transform data for Excel with separated address columns
      const excelData = filteredData.map(record => {
        const { cityState, zip } = parseCityStateZip(record.owner_csz);

        return {
          'Block': record.property_block,
          'Lot': record.property_lot,
          'Qualifier': record.property_qualifier || '',
          'Property Class': record.property_m4_class,
          'Location': record.property_location,
          'Owner': record.owner_name,
          'Address': record.owner_street || '',
          'City, State': cityState,
          'Zip': zip
        };
      });

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Mailing List');

      // Set column widths to fit content properly
      const colWidths = [
        { wch: 12 }, // Block
        { wch: 15 }, // Lot
        { wch: 12 }, // Qualifier
        { wch: 15 }, // Property Class
        { wch: 45 }, // Location
        { wch: 35 }, // Owner
        { wch: 40 }, // Address
        { wch: 30 }, // City, State
        { wch: 12 }  // Zip
      ];
      ws['!cols'] = colWidths;

      // Apply styling: Leelawadee font size 10, centered data, bold headers
      const headerCells = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'];
      const range = XLSX.utils.decode_range(ws['!ref']);

      // Style all cells
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          // Initialize cell style if it doesn't exist
          if (!ws[cellAddress].s) ws[cellAddress].s = {};

          // Apply font and alignment to all cells
          ws[cellAddress].s = {
            font: { name: 'Leelawadee', sz: 10, bold: R === 0 }, // Bold for header row
            alignment: { horizontal: 'center', vertical: 'center' }
          };
        }
      }

      // Generate Excel file and download
      const fileName = jobData?.job_name ?
        `${jobData.job_name.replace(/[^a-z0-9]/gi, '_')}_Initial_Mailing_List.xlsx` :
        `Initial_Mailing_List_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      console.log(`✅ Excel file downloaded with ${excelData.length} properties`);

    } catch (error) {
      console.error('Error generating mailing list:', error);
      alert('Failed to generate mailing list. Please ensure property data is loaded.');
    } finally {
      setGeneratingLists(prev => ({ ...prev, initial: false }));
    }
  };

  // ENHANCED: Direct Excel download for 2nd Attempt Mailer
  const generateSecondAttemptMailerExcel = async () => {
    try {
      setGeneratingLists(prev => ({ ...prev, second: true }));
      console.log('🔄 Generating 2nd attempt mailer as Excel...');
      
      // Get the job's refusal configuration
      const { data: jobConfig, error: jobError } = await supabase
        .from('jobs')
        .select('infoby_category_config')
        .eq('id', jobData.id)
        .single();
      
      if (jobError) throw jobError;
      
      const refusalCategories = jobConfig?.infoby_category_config?.refusal || [];
      console.log('📋 Refusal codes for this job:', refusalCategories);
      
      // Get ALL property records with pagination
      const propertyData = await getAllPropertyRecords(jobData.id);
      
      // Get ALL inspection data with pagination
      const inspectionData = await getAllInspectionData(jobData.id);
      console.log(`🔍 Found ${inspectionData.length} inspection records`);
      
      // Create a map of inspection data by composite key
      const inspectionMap = new Map();
      inspectionData.forEach(inspection => {
        if (inspection.property_composite_key) {
          inspectionMap.set(inspection.property_composite_key, inspection);
        }
      });
      
      // Filter properties for 2nd attempt
      const secondAttemptProperties = propertyData.filter(property => {
        const propClass = property.property_m4_class?.toUpperCase() || '';
        const inspection = property.property_composite_key ? 
          inspectionMap.get(property.property_composite_key) : null;
        
        // Check if it's a refusal based on job config
        if (inspection && refusalCategories.includes(inspection.info_by_code)) {
          return true;
        }
        
        // Check if it's class 2 or 3A with no inspection (list_by is null or empty)
        if (['2', '3A'].includes(propClass)) {
          if (!inspection || !inspection.list_by || inspection.list_by.trim() === '') {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`✅ Found ${secondAttemptProperties.length} properties for 2nd attempt`);
      
      // Transform data for Excel with separated address columns
      const excelData = secondAttemptProperties.map(property => {
        const inspection = property.property_composite_key ?
          inspectionMap.get(property.property_composite_key) : null;

        let reason = 'Not Inspected';
        if (inspection) {
          if (refusalCategories.includes(inspection.info_by_code)) {
            reason = inspection.info_by_code;
          }
        }

        const { cityState, zip } = parseCityStateZip(property.owner_csz);

        return {
          'Block': property.property_block,
          'Lot': property.property_lot,
          'Qualifier': property.property_qualifier || '',
          'Property Class': property.property_m4_class,
          'Location': property.property_location,
          'Owner': property.owner_name,
          'Address': property.owner_street || '',
          'City, State': cityState,
          'Zip': zip,
          'Reason': reason
        };
      });

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '2nd Attempt Mailer');

      // Set column widths to fit content properly
      const colWidths = [
        { wch: 12 }, // Block
        { wch: 15 }, // Lot
        { wch: 12 }, // Qualifier
        { wch: 15 }, // Property Class
        { wch: 45 }, // Location
        { wch: 35 }, // Owner
        { wch: 40 }, // Address
        { wch: 30 }, // City, State
        { wch: 12 }, // Zip
        { wch: 20 }  // Reason
      ];
      ws['!cols'] = colWidths;

      // Apply styling: Leelawadee font size 10, centered data, bold headers
      const range = XLSX.utils.decode_range(ws['!ref']);

      // Style all cells
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          // Initialize cell style if it doesn't exist
          if (!ws[cellAddress].s) ws[cellAddress].s = {};

          // Apply font and alignment to all cells
          ws[cellAddress].s = {
            font: { name: 'Leelawadee', sz: 10, bold: R === 0 }, // Bold for header row
            alignment: { horizontal: 'center', vertical: 'center' }
          };
        }
      }
      
      // Generate Excel file and download
      XLSX.writeFile(wb, `${jobData.job_name}_2nd_Attempt_Mailer.xlsx`);
      
      console.log(`✅ Excel file downloaded with ${excelData.length} properties`);
      
    } catch (error) {
      console.error('Error generating 2nd attempt mailer:', error);
      alert('Failed to generate 2nd attempt mailer list.');
    } finally {
      setGeneratingLists(prev => ({ ...prev, second: false }));
    }
  };

  // ENHANCED: Direct Excel download for 3rd Attempt Mailer
  const generateThirdAttemptMailerExcel = async () => {
    try {
      setGeneratingLists(prev => ({ ...prev, third: true }));
      console.log('🔄 Generating 3rd attempt mailer as Excel...');
      
      // Get the job's refusal configuration
      const { data: jobConfig, error: jobError } = await supabase
        .from('jobs')
        .select('infoby_category_config')
        .eq('id', jobData.id)
        .single();
      
      if (jobError) throw jobError;
      
      const refusalCategories = jobConfig?.infoby_category_config?.refusal || [];
      console.log('📋 Refusal codes for this job:', refusalCategories);
      
      // Get ALL property records with pagination
      const propertyData = await getAllPropertyRecords(jobData.id);
      
      // Get ALL inspection data with pagination
      const inspectionData = await getAllInspectionData(jobData.id);
      
      // Create a map of inspection data by composite key
      const inspectionMap = new Map();
      inspectionData.forEach(inspection => {
        if (inspection.property_composite_key) {
          inspectionMap.set(inspection.property_composite_key, inspection);
        }
      });
      
      // Filter properties for 3rd attempt (same logic as 2nd for now)
      const thirdAttemptProperties = propertyData.filter(property => {
        const propClass = property.property_m4_class?.toUpperCase() || '';
        const inspection = property.property_composite_key ? 
          inspectionMap.get(property.property_composite_key) : null;
        
        // Check if it's a refusal based on job config
        if (inspection && refusalCategories.includes(inspection.info_by_code)) {
          return true;
        }
        
        // Check if it's class 2 or 3A with no inspection (list_by is null or empty)
        if (['2', '3A'].includes(propClass)) {
          if (!inspection || !inspection.list_by || inspection.list_by.trim() === '') {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`✅ Found ${thirdAttemptProperties.length} properties for 3rd attempt`);
      
      // Transform data for Excel with separated address columns
      const excelData = thirdAttemptProperties.map(property => {
        const inspection = property.property_composite_key ?
          inspectionMap.get(property.property_composite_key) : null;

        let reason = 'Not Inspected';
        if (inspection) {
          if (refusalCategories.includes(inspection.info_by_code)) {
            reason = inspection.info_by_code;
          }
        }

        const { cityState, zip } = parseCityStateZip(property.owner_csz);

        return {
          'Block': property.property_block,
          'Lot': property.property_lot,
          'Qualifier': property.property_qualifier || '',
          'Property Class': property.property_m4_class,
          'Location': property.property_location,
          'Owner': property.owner_name,
          'Address': property.owner_street || '',
          'City, State': cityState,
          'Zip': zip,
          'Reason': reason
        };
      });

      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '3rd Attempt Mailer');

      // Set column widths to fit content properly
      const colWidths = [
        { wch: 12 }, // Block
        { wch: 15 }, // Lot
        { wch: 12 }, // Qualifier
        { wch: 15 }, // Property Class
        { wch: 45 }, // Location
        { wch: 35 }, // Owner
        { wch: 40 }, // Address
        { wch: 30 }, // City, State
        { wch: 12 }, // Zip
        { wch: 20 }  // Reason
      ];
      ws['!cols'] = colWidths;

      // Apply styling: Leelawadee font size 10, centered data, bold headers
      const range = XLSX.utils.decode_range(ws['!ref']);

      // Style all cells
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          // Initialize cell style if it doesn't exist
          if (!ws[cellAddress].s) ws[cellAddress].s = {};

          // Apply font and alignment to all cells
          ws[cellAddress].s = {
            font: { name: 'Leelawadee', sz: 10, bold: R === 0 }, // Bold for header row
            alignment: { horizontal: 'center', vertical: 'center' }
          };
        }
      }
      
      // Generate Excel file and download
      XLSX.writeFile(wb, `${jobData.job_name}_3rd_Attempt_Mailer.xlsx`);
      
      console.log(`✅ Excel file downloaded with ${excelData.length} properties`);
      
    } catch (error) {
      console.error('Error generating 3rd attempt mailer:', error);
      alert('Failed to generate 3rd attempt mailer list.');
    } finally {
      setGeneratingLists(prev => ({ ...prev, third: false }));
    }
  };
  const handleTurnoverDate = async (itemId, date) => {
    if (date) {
      // Update the item status to completed
      await handleItemStatusChange(itemId, 'completed');

      // Save the turnover date to the job
      try {
        const { error } = await supabase
          .from('jobs')
          .update({
            turnover_date: date,
            updated_at: new Date().toISOString()
          })
          .eq('id', jobData.id);

        if (error) {
          console.error('Error saving turnover date:', error);
        } else {
          console.log('✅ Turnover date saved:', date);
        }
      } catch (err) {
        console.error('Error saving turnover date:', err);
      }
      // Archive can be done manually from Admin Jobs
    }
  };

  const downloadFile = async (filePath, fileName) => {
    try {
      console.log('🔽 Download initiated for:', filePath);
      
      // Method 1: Try to create a signed URL for download (more secure)
      console.log('Attempting signed URL method...');
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('checklist-documents')
        .createSignedUrl(filePath, 3600); // URL valid for 1 hour
      
      if (signedUrlError) {
        console.error('Signed URL error:', signedUrlError);
      }
      
      if (signedUrlData?.signedUrl) {
        console.log('✅ Signed URL created successfully');
        // Create a temporary anchor element to trigger download
        const link = document.createElement('a');
        link.href = signedUrlData.signedUrl;
        link.download = fileName || filePath.split('/').pop();
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('�� Download triggered via signed URL');
        return;
      }
      
      // Method 2: If signed URL fails, try direct download
      console.log('Attempting direct download method...');
      const { data: downloadData, error: downloadError } = await supabase.storage
        .from('checklist-documents')
        .download(filePath);
      
      if (downloadError) {
        console.error('Direct download error:', downloadError);
      }
      
      if (downloadData) {
        console.log('✅ File downloaded as blob, size:', downloadData.size);
        // Create blob URL and trigger download
        const url = URL.createObjectURL(downloadData);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || filePath.split('/').pop();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('✅ Download triggered via blob');
        return;
      }
      
      // If both methods fail, try public URL as last resort
      console.log('Attempting public URL method...');
      const { data: publicUrlData } = supabase.storage
        .from('checklist-documents')
        .getPublicUrl(filePath);
      
      if (publicUrlData?.publicUrl) {
        console.log('✅ Opening public URL:', publicUrlData.publicUrl);
        window.open(publicUrlData.publicUrl, '_blank');
      } else {
        throw new Error('Could not download file - all methods failed');
      }
    } catch (error) {
      console.error('❌ Error downloading file:', error);
      console.error('File path was:', filePath);
      alert(`Failed to download file: ${error.message}\n\nFile path: ${filePath}\n\nCheck the console for more details.`);
    }
  };

  const confirmArchive = async () => {
    try {
      // Archive the job
      await checklistService.archiveJob(jobData.id, new Date().toISOString());
      
      setShowArchiveConfirm(false);
      alert('Job has been archived successfully!');
      
      // Go back to jobs list
      onBackToJobs();
    } catch (error) {
      console.error('Error archiving job:', error);
      alert('Failed to archive job. Please try again.');
    }
  };

  // Items that should show a Mark Complete button instead of a Go to Section link
  const replaceGoToWithComplete = new Set([
    'Land Value Tables Built',
    'Land Values Entered',
    'Building Class Review/Updated',
    'Effective Age Loaded/Set'
  ]);

  // Navigate to analysis section with detailed mapping and subtab dispatching
  const navigateToAnalysisSection = (sectionName) => {
    try {
      console.log(`Navigate to analysis section: ${sectionName}`);

      // Detailed mapping: for each checklist item determine which parent module and inner tab/subtab to open
      const mapping = {
        'Market Analysis': { module: 'market-analysis', tab: 'pre-valuation', subtabEvent: { name: 'navigate_prevaluation_subtab', tabId: 'marketAnalysis' } },
        'Page by Page Analysis': { module: 'market-analysis', tab: 'pre-valuation', subtabEvent: { name: 'navigate_prevaluation_subtab', tabId: 'worksheet' } },
        'VCS Reviewed/Reset': { module: 'market-analysis', tab: 'land-valuation', subtabEvent: { name: 'navigate_landvaluation_subtab', tabId: 'vcs-sheet' } },
        'Cost Conversion Factor Set': { module: 'market-analysis', tab: 'cost-valuation' },
        'Effective Age Loaded/Set': { module: 'final-valuation' },
        'Final Values Ready': { module: 'final-valuation' },
        // Fallback: open market-analysis data-quality
        'Data Quality Analysis': { module: 'market-analysis', tab: 'data-quality' }
      };

      const mapEntry = mapping[sectionName] || mapping['Data Quality Analysis'];

      // If the target module is final-valuation, switch parent module to final-valuation
      if (mapEntry.module === 'final-valuation') {
        if (typeof onSubModuleChange === 'function') onSubModuleChange('final-valuation');
        return;
      }

      // Otherwise switch to Market & Land Analysis module and select the specified inner tab
      if (typeof onSubModuleChange === 'function') {
        onSubModuleChange('market-analysis');
      }

      setTimeout(() => {
        try {
          if (mapEntry.tab) {
            window.dispatchEvent(new CustomEvent('navigate_market_analysis_tab', { detail: { tabId: mapEntry.tab } }));
          }
          if (mapEntry.subtabEvent) {
            window.dispatchEvent(new CustomEvent(mapEntry.subtabEvent.name, { detail: { tabId: mapEntry.subtabEvent.tabId } }));
          }
        } catch (e) {
          console.error('Failed to dispatch navigation events', e);
        }
      }, 150);

    } catch (e) {
      console.error('navigateToAnalysisSection error:', e);
    }
  };

  if (!jobData) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="text-center text-gray-500 py-12">
          <AlertCircle className="w-16 h-16 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Job Selected</h3>
          <p>Please select a job from the Job Management to view the checklist.</p>
        </div>
      </div>
    );
  }

  if (isLoadingItems) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="text-center text-gray-500 py-12">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold mb-2">Loading Checklist Items...</h3>
          <p>Preparing your project checklist...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Job Information Panel */}
      <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">{jobData.job_name}</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Assessor Name:</label>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editableAssessorName}
                    onChange={(e) => setEditableAssessorName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm flex-1"
                    placeholder="Enter assessor name"
                  />
                  {hasAssessorNameChanges && (
                    <button
                      onClick={saveAssessorName}
                      className="px-3 py-2 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 flex items-center gap-1"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Assessor Email:</label>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="email"
                    value={editableAssessorEmail}
                    onChange={(e) => setEditableAssessorEmail(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm flex-1"
                    placeholder="Enter assessor email"
                  />
                  {hasAssessorEmailChanges && (
                    <button
                      onClick={saveAssessorEmail}
                      className="px-3 py-2 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 flex items-center gap-1"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Lead Manager:</label>
                <span className="text-sm text-gray-600">
                  {jobData.assignedManagers && jobData.assignedManagers.length > 0 
                    ? jobData.assignedManagers.find(m => m.role === 'Lead Manager')?.name || jobData.assignedManagers[0]?.name
                    : 'Not assigned'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">For Tax Year:</label>
                <span className="text-sm text-gray-600">{dueYear}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Year of Value:</label>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={editableYearOfValue}
                    onChange={(e) => setEditableYearOfValue(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm w-28"
                    placeholder={dueYear !== 'TBD' ? String(parseInt(dueYear) - 1) : 'e.g. 2024'}
                    min="1990"
                    max="2100"
                  />
                  {hasYearOfValueChanges && (
                    <button
                      onClick={saveYearOfValue}
                      className="px-3 py-2 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 flex items-center gap-1"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                  )}
                  <span className="text-xs text-gray-400">Used for sales period identification</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Municipality:</label>
                <span className="text-sm text-gray-600">{jobData.municipality || 'Not specified'}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Project Type</label>
              <div className="flex gap-4">
                <button
                  onClick={async () => {
                    setChecklistType('revaluation');
                    // Save to database
                    await supabase
                      .from('jobs')
                      .update({ project_type: 'revaluation' })
                      .eq('id', jobData.id);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    checklistType === 'revaluation' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  🏢 Revaluation
                </button>
                <button
                  onClick={async () => {
                    setChecklistType('reassessment');
                    // Save to database
                    await supabase
                      .from('jobs')
                      .update({ project_type: 'reassessment' })
                      .eq('id', jobData.id);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    checklistType === 'reassessment' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  📊 Reassessment
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">As of Date:</label>
                <span className="text-sm text-gray-600">{formatDate(jobData?.asOfDate)}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Source File Date:</label>
                <span className="text-sm text-gray-600">{formatDate(jobData?.sourceFileDate)}</span>
                <span className="text-xs text-gray-500">(from property records)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Overall Progress</p>
                <p className="text-2xl font-bold text-blue-600">{Math.round(completionPercentage)}%</p>
              </div>
              <CheckCircle className="w-8 h-8 text-blue-500" />
            </div>
            <div className="mt-2 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed Items</p>
                <p className="text-2xl font-bold text-green-600">{completedCount}</p>
              </div>
              <CheckSquare className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">of {totalCount} total items</p>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Client Approvals</p>
                <p className="text-2xl font-bold text-purple-600">
                  {applicableItems.filter(item => item.client_approved === true).length}
                </p>
              </div>
              <UserCheck className="w-8 h-8 text-purple-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              of {applicableItems.filter(item => item.requires_client_approval).length} required
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Files Uploaded</p>
                <p className="text-2xl font-bold text-orange-600">
                  {applicableItems.filter(item => item.file_attachment_path && validFiles[item.id]).length}
                </p>
              </div>
              <Upload className="w-8 h-8 text-orange-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              of {applicableItems.filter(item => item.allows_file_upload).length} allowed
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-4 rounded-lg border mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <label className="text-sm font-medium text-gray-700">Category:</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="all">All Categories</option>
              <option value="setup">🏢 Setup</option>
              <option value="inspection">👁️ Inspection</option>
              <option value="analysis">🎯 Analysis</option>
              <option value="completion">✅ Completion</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-64"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showCompleted"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="showCompleted" className="text-sm text-gray-700">
              Show completed items
            </label>
          </div>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-4">
        {filteredItems.map(item => {
          const CategoryIcon = getCategoryIcon(item.category);
          const categoryColor = getCategoryColor(item.category);
          const statusColor = getStatusColor(item.status);
          const hasValidFile = item.file_attachment_path && validFiles[item.id];
          const isProcessingApproval = processingApprovals[item.id];
          
          // Check if this item should be disabled for reassessment
          const isNotApplicableForReassessment = checklistType === 'reassessment' && 
            (item.category === 'analysis' || item.category === 'completion');

          return (
            <div key={item.id} className={`bg-white border rounded-lg p-4 transition-shadow ${
              isNotApplicableForReassessment 
                ? 'border-gray-100 bg-gray-50 opacity-60' 
                : item.status === 'completed' 
                  ? 'border-green-200 bg-green-50 hover:shadow-md' 
                  : 'border-gray-200 hover:shadow-md'
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg bg-${categoryColor}-100`}>
                    <CategoryIcon className={`w-5 h-5 text-${categoryColor}-600`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={`font-medium ${isNotApplicableForReassessment ? 'text-gray-500' : 'text-gray-800'}`}>
                        {item.item_text}
                      </h3>
                      {/* Show Not Applicable badge for reassessment */}
                      {isNotApplicableForReassessment && (
                        <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full">
                          Not Applicable - Reassessment
                        </span>
                      )}
                      {/* Analysis items show sync badge instead of auto-update */}
                      {item.is_analysis_item && !isNotApplicableForReassessment && (
                        <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                          Synced from Analysis
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                      <span className={`px-2 py-1 bg-${categoryColor}-100 text-${categoryColor}-700 rounded-full text-xs capitalize`}>
                        {item.category}
                      </span>
                    </div>
                    {item.completed_at && (
                      <div className="text-sm text-gray-500 mb-2">
                        Completed on {new Date(item.completed_at).toLocaleDateString()}
                      </div>
                    )}
                    {item.client_approved === true && item.client_approved_date && (
                      <div className="text-sm text-purple-600 bg-purple-50 px-2 py-1 rounded mb-2 inline-block">
                        ✓ Client approved on {new Date(item.client_approved_date).toLocaleDateString()}
                      </div>
                    )}
                    {hasValidFile && (
                      <div className="space-y-1">
                        {item.item_text === 'Initial Letter and Brochure' ? (
                          // Check for multiple files in checklist_documents
                          checklistDocuments && checklistDocuments[item.id] && checklistDocuments[item.id].length > 0 ? (
                            checklistDocuments[item.id].map((doc, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm text-blue-600">
                                <FileText className="w-4 h-4" />
                                <button
                                  onClick={() => downloadFile(doc.file_path, doc.file_name || doc.file_path.split('/').pop())}
                                  className="hover:text-blue-800 hover:underline text-left"
                                >
                                  {doc.file_name || doc.file_path.split('/').pop()}
                                </button>
                                <ExternalLink className="w-4 h-4" />
                              </div>
                            ))
                          ) : (
                            // Fallback to single file display
                            <div className="flex items-center gap-2 text-sm text-blue-600">
                              <FileText className="w-4 h-4" />
                              <button
                                onClick={() => downloadFile(item.file_attachment_path, item.file_attachment_path.split('/').pop())}
                                className="hover:text-blue-800 hover:underline text-left"
                              >
                                {item.file_attachment_path.split('/').pop()}
                              </button>
                              <ExternalLink className="w-4 h-4" />
                            </div>
                          )
                        ) : (
                          // Single file display for other items
                          <div className="flex items-center gap-2 text-sm text-blue-600">
                            <FileText className="w-4 h-4" />
                            <button
                              onClick={() => downloadFile(item.file_attachment_path, item.file_attachment_path.split('/').pop())}
                              className="hover:text-blue-800 hover:underline text-left"
                            >
                              {item.file_attachment_path.split('/').pop()}
                            </button>
                            <ExternalLink className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    )}
                    {item.notes && (
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded mt-2">
                        <strong>Notes:</strong> {item.notes}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  {/* Don't show any buttons if not applicable for reassessment */}
                  {isNotApplicableForReassessment ? (
                    <span className="text-sm text-gray-500 italic">N/A</span>
                  ) : (
                    <>
                  {/* Don't show Mark Complete button for analysis items that sync from other components */}
                  {item.status === 'completed' ? (
    <button
      onClick={() => handleItemStatusChange(item.id, 'pending')}
      className="inline-flex items-center px-3 py-1 rounded-md bg-green-50 text-green-800 text-sm font-medium hover:bg-green-100"
      title="Click to mark as not completed"
    >
      <CheckSquare className="w-4 h-4 mr-2" />
      Completed
    </button>
  ) : (
    // Allow Mark Complete for regular items OR ones specified to replace Go To with Complete
    (!item.is_analysis_item || replaceGoToWithComplete.has(item.item_text)) && (
      <button
        onClick={() => handleItemStatusChange(item.id, 'completed')}
        className="px-3 py-1 rounded-md text-sm font-medium transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300"
      >
        Mark Complete
      </button>
    )
  )}
                  
                  {/* Show Go to Section button for analysis items unless explicitly replaced with Mark Complete */}
  {item.is_analysis_item && !replaceGoToWithComplete.has(item.item_text) && (
    <button
      onClick={() => navigateToAnalysisSection(item.item_text)}
      className="px-3 py-1 bg-purple-500 text-white rounded-md text-sm hover:bg-purple-600 flex items-center gap-1"
    >
      <ArrowRight className="w-4 h-4" />
      Go to Section
    </button>
  )}
                  
                  {item.requires_client_approval && (
                    <button
                      onClick={() => handleClientApproval(item.id, !item.client_approved)}
                      disabled={isProcessingApproval}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 justify-center ${
                        item.client_approved === true
                          ? 'bg-purple-500 text-white hover:bg-purple-600'
                          : 'bg-purple-200 text-purple-700 hover:bg-purple-300'
                      } ${isProcessingApproval ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={item.client_approved === true ? 'Click to remove approval' : 'Click to approve'}
                    >
                      {isProcessingApproval ? (
                        <>Processing...</>
                      ) : item.client_approved === true ? (
                        <>
                          <UserCheck className="w-4 h-4" />
                          Approved
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4" />
                          Not Approved
                        </>
                      )}
                    </button>
                  )}
                  {item.allows_file_upload && item.item_text === 'Initial Letter and Brochure' && (
                    <button
                      onClick={() => handleFileSelect(item.id, item.item_text)}
                      disabled={uploadingItems[item.id]}
                      className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-1"
                    >
                      <Upload className="w-4 h-4" />
                      {uploadingItems[item.id] ? 'Uploading...' : 'Upload Files'}
                    </button>
                  )}
                  {item.allows_file_upload && item.item_text !== 'Initial Letter and Brochure' && (
                    <button
                      onClick={() => handleFileSelect(item.id, item.item_text)}
                      disabled={uploadingItems[item.id]}
                      className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-1"
                    >
                      <Upload className="w-4 h-4" />
                      {uploadingItems[item.id] ? 'Uploading...' : 'Upload File'}
                    </button>
                  )}
                  {item.special_action === 'generate_mailing_list' && (
                    <button
                      onClick={generateMailingListExcel}
                      disabled={generatingLists.initial}
                      className="px-3 py-1 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 disabled:bg-gray-400 flex items-center gap-1"
                    >
                      <Download className="w-4 h-4" />
                      {generatingLists.initial ? 'Generating...' : 'Download Excel'}
                    </button>
                  )}
                  {item.special_action === 'generate_second_attempt_mailer' && (
                    <button 
                      onClick={generateSecondAttemptMailerExcel}
                      disabled={generatingLists.second}
                      className="px-3 py-1 bg-yellow-500 text-white rounded-md text-sm hover:bg-yellow-600 disabled:bg-gray-400 flex items-center gap-1"
                    >
                      <Download className="w-4 h-4" />
                      {generatingLists.second ? 'Generating...' : '2nd Attempt Excel'}
                    </button>
                  )}
                  {item.special_action === 'generate_third_attempt_mailer' && (
                    <button 
                      onClick={generateThirdAttemptMailerExcel}
                      disabled={generatingLists.third}
                      className="px-3 py-1 bg-red-500 text-white rounded-md text-sm hover:bg-red-600 disabled:bg-gray-400 flex items-center gap-1"
                    >
                      <Download className="w-4 h-4" />
                      {generatingLists.third ? 'Generating...' : '3rd Attempt Excel'}
                    </button>
                  )}
                  {item.input_type === 'date' && (
                    <input
                      type="date"
                      onChange={(e) => handleTurnoverDate(item.id, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                      placeholder="Select turnover date"
                    />
                  )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Archive Confirmation Modal */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <Archive className="w-8 h-8 text-orange-500" />
              <h3 className="text-lg font-semibold">Archive Job</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Are you sure you want to mark this job as complete and archive it? This will move the job to archived status in Job Management.
            </p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
              >
                Archive Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagementChecklist;
