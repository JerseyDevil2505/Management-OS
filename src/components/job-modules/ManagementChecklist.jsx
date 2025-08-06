import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle, Clock, AlertCircle, Users, Calendar, FileText, Settings, Database, 
  Plus, Edit3, Trash2, ArrowLeft, Download, Upload, Filter, Search, Eye, UserCheck, 
  Building, MapPin, Mail, FileCheck, Target, ExternalLink, FileUp, CheckSquare, 
  Square, FileDown, Printer, Archive, Save, X, XCircle, ArrowRight
} from 'lucide-react';
import { supabase, checklistService } from '../../lib/supabaseClient';
import * as XLSX from 'xlsx';

const ManagementChecklist = ({ jobData, onBackToJobs, activeSubModule = 'checklist', onSubModuleChange }) => {
  const [editableAssessorName, setEditableAssessorName] = useState(jobData?.assessor_name || '');
  const [editableAssessorEmail, setEditableAssessorEmail] = useState(jobData?.assessor_email || '');
  const [hasAssessorNameChanges, setHasAssessorNameChanges] = useState(false);
  const [hasAssessorEmailChanges, setHasAssessorEmailChanges] = useState(false);
  const [checklistType, setChecklistType] = useState('revaluation');
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
    const loadJobDetails = async () => {
      if (jobData?.id) {
        // Fetch the latest job data to get saved assessor info
        const { data, error } = await supabase
          .from('jobs')
          .select('assessor_name, assessor_email')
          .eq('id', jobData.id)
          .single();
        
        if (data && !error) {
          setEditableAssessorName(data.assessor_name || '');
          setEditableAssessorEmail(data.assessor_email || '');
        }
      }
    };
    
    loadJobDetails();
  }, [jobData?.id]);

  useEffect(() => {
    if (jobData) {
      loadChecklistItems();
    }
  }, [jobData, checklistType]);

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
              .from('checklist_items')
              .update({ file_attachment_path: null })
              .eq('id', item.id);
          }
        } catch (err) {
          console.error('Error checking file:', err);
          fileChecks[item.id] = false;
        }
      }
    }
    
    setValidFiles(fileChecks);
  };

  // Enhanced function to get ALL property records with pagination
  const getAllPropertyRecords = async (jobId) => {
    console.log('📊 Fetching all property records for job:', jobId);
    let allRecords = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    
    // First, get the latest file_version
    const { data: versionData, error: versionError } = await supabase
      .from('property_records')
      .select('file_version')
      .eq('job_id', jobId)
      .order('file_version', { ascending: false })
      .limit(1);
    
    if (versionError || !versionData || versionData.length === 0) {
      console.error('Error getting file version:', versionError);
      return [];
    }
    
    const latestVersion = versionData[0].file_version;
    console.log('📌 Latest file version:', latestVersion);
    
    // Now fetch all records with pagination
    while (hasMore) {
      const { data, error } = await supabase
        .from('property_records')
        .select(`
          property_block,
          property_lot,
          property_qualifier,
          property_m4_class,
          property_location,
          property_facility,
          owner_name,
          owner_street,
          owner_csz,
          property_composite_key,
          inspection_info_by
        `)
        .eq('job_id', jobId)
        .eq('file_version', latestVersion)
        .range(offset, offset + limit - 1);
      
      if (error) {
        console.error('Error fetching property records:', error);
        break;
      }
      
      if (data && data.length > 0) {
        allRecords = [...allRecords, ...data];
        console.log(`📦 Fetched ${data.length} records (total so far: ${allRecords.length})`);
        hasMore = data.length === limit;
        offset += limit;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`✅ Total property records fetched: ${allRecords.length}`);
    return allRecords;
  };

  // Enhanced function to get ALL inspection data with pagination
  const getAllInspectionData = async (jobId) => {
    console.log('🔍 Fetching all inspection data for job:', jobId);
    let allRecords = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    
    // First, get the latest file_version for inspection data
    const { data: versionData, error: versionError } = await supabase
      .from('inspection_data')
      .select('file_version')
      .eq('job_id', jobId)
      .order('file_version', { ascending: false })
      .limit(1);
    
    if (versionError || !versionData || versionData.length === 0) {
      console.error('Error getting inspection file version:', versionError);
      // Return empty array if no inspection data exists yet
      return [];
    }
    
    const latestVersion = versionData[0].file_version;
    console.log('📌 Latest inspection file version:', latestVersion);
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('inspection_data')
        .select(`
          block,
          lot,
          qualifier,
          property_composite_key,
          info_by_code,
          list_by,
          measure_date,
          list_date
        `)
        .eq('job_id', jobId)
        .eq('file_version', latestVersion)
        .range(offset, offset + limit - 1);
      
      if (error) {
        console.error('Error fetching inspection data:', error);
        break;
      }
      
      if (data && data.length > 0) {
        allRecords = [...allRecords, ...data];
        console.log(`📦 Fetched ${data.length} inspection records (total so far: ${allRecords.length})`);
        hasMore = data.length === limit;
        offset += limit;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`✅ Total inspection records fetched: ${allRecords.length}`);
    return allRecords;
  };

  // Load checklist items from database
  const loadChecklistItems = async () => {
    try {
      setIsLoadingItems(true);
      
      // First, try to load existing items from checklist_items - ensure DISTINCT results
      let { data: items, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('job_id', jobData.id)
        .order('item_order');
      
      if (itemsError) {
        console.error('Error loading checklist items:', itemsError);
        items = [];
      }
      
      // Remove any duplicates based on id (in case of data issues)
      const uniqueItems = items ? Array.from(new Map(items.map(item => [item.id, item])).values()) : [];
      
      // If no items exist, create them from template
      if (!uniqueItems || uniqueItems.length === 0) {
        
        // Get the standard revaluation template
        const { data: template, error: templateError } = await supabase
          .from('checklist_templates')
          .select('id')
          .eq('name', 'Standard Revaluation Checklist')
          .single();

        if (templateError || !template) {
          console.error('Template not found:', templateError);
          throw new Error('Checklist template not found');
        }

        // Get all template items
        const { data: templateItems, error: templateItemsError } = await supabase
          .from('checklist_template_items')
          .select('*')
          .eq('template_id', template.id)
          .order('item_order');

        if (templateItemsError || !templateItems) {
          console.error('Template items not found:', templateItemsError);
          throw new Error('Template items not found');
        }

        // Create checklist items for this job based on template
        const itemsToCreate = templateItems.map(templateItem => ({
          job_id: jobData.id,
          template_item_id: templateItem.id,
          item_text: templateItem.item_text,
          item_order: templateItem.item_order,
          category: templateItem.category,
          status: 'pending',
          requires_client_approval: templateItem.requires_client_approval || false,
          allows_file_upload: templateItem.allows_file_upload || false,
          auto_update_source: templateItem.auto_update_source,
          created_at: new Date().toISOString()
        }));

        const { data: createdItems, error: createError } = await supabase
          .from('checklist_items')
          .insert(itemsToCreate)
          .select();

        if (createError) {
          console.error('Error creating checklist items:', createError);
          throw createError;
        }

        items = createdItems;
      } else {
        items = uniqueItems;
      }
      
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
      
      // Add special action flags based on item text
      items = items.map(item => {
        // Check if this is an analysis phase item that should be synced
        const analysisItems = [
          'Cost Conversion Factor',
          'Land Value Analysis',
          'Market Analysis',
          'Depreciation Analysis',
          'Final Value Review'
        ];
        
        if (analysisItems.includes(item.item_text)) {
          item.is_analysis_item = true;
          item.sync_from_component = true;
        }
        
        // Add special actions based on item text
        if (item.item_text === 'Initial Mailing List') {
          item.special_action = 'generate_mailing_list';
        } else if (item.item_text === 'Second Attempt Inspections') {
          item.special_action = 'generate_second_attempt_mailer';
        } else if (item.item_text === 'Third Attempt Inspections') {
          item.special_action = 'generate_third_attempt_mailer';
        } else if (item.item_text === 'Generate Turnover Document') {
          item.special_action = 'generate_turnover_pdf';
        } else if (item.item_text === 'Turnover Date') {
          item.input_type = 'date';
          item.special_action = 'archive_trigger';
        }
        
        return item;
      });
      
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

  const completedCount = checklistItems.filter(item => item.status === 'completed').length;
  const totalCount = checklistItems.length;
  const completionPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleItemStatusChange = async (itemId, newStatus) => {
    try {
      // Update in database first
      const updatedItem = await checklistService.updateItemStatus(
        itemId, 
        newStatus, 
        currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      );
      
      // Then update local state with the response
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? { ...item, ...updatedItem } : item
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
      
      // Update in database first
      const updatedItem = await checklistService.updateClientApproval(
        itemId, 
        approved, 
        currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      );
      
      console.log('Updated item from service:', updatedItem);
      
      // Then update local state with the response
      setChecklistItems(items => {
        const newItems = items.map(item => {
          if (item.id === itemId) {
            // Ensure we're properly updating the client_approved field
            const updated = { 
              ...item, 
              ...updatedItem,
              client_approved: approved, // Explicitly set this
              client_approved_at: approved ? new Date().toISOString() : null,
              client_approved_by: approved ? (currentUser?.name || 'Jim Duda') : null
            };
            console.log('Local state update for item:', updated);
            return updated;
          }
          return item;
        });
        return newItems;
      });

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
          
          // Upload all files
          const uploadPromises = files.map(file => 
            checklistService.uploadFile(
              itemId, 
              jobData.id, 
              file, 
              currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
            )
          );
          
          await Promise.all(uploadPromises);
          
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
        // Single file upload (existing logic)
        const file = files[0];
        console.log(`📄 File selected for ${itemText}: ${file.name}`);
        
        if (file.size > 200 * 1024 * 1024) {
          alert('File size exceeds 200MB limit');
          return;
        }
        
        setUploadingItems(prev => ({ ...prev, [itemId]: true }));
        
        try {
          console.log(`⬆️ Starting upload for item ${itemId}: ${itemText}`);
          
          // Upload file and update item
          const updatedItem = await checklistService.uploadFile(
            itemId, 
            jobData.id, 
            file, 
            currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
          );
          
          console.log(`✅ Upload complete for ${itemText}`, updatedItem);
          
          // Update local state
          setChecklistItems(items => items.map(item => 
            item.id === itemId ? { ...item, ...updatedItem } : item
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
      // Save to database - update assessor_name field
      await supabase
        .from('jobs')
        .update({ assessor_name: editableAssessorName })
        .eq('id', jobData.id);
      
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
      // Save to database - update assessor_email field
      await supabase
        .from('jobs')
        .update({ assessor_email: editableAssessorEmail })
        .eq('id', jobData.id);
      
      // Update local state
      setHasAssessorEmailChanges(false);
      
      // Success feedback
      alert('Assessor email updated successfully!');
    } catch (error) {
      console.error('Error saving assessor email:', error);
      alert('Failed to save assessor email. Please try again.');
    }
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
        
        // Include class 15 with specific facility names
        if (propClass === '15' && record.property_facility) {
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
      
      // Transform data for Excel
      const excelData = filteredData.map(record => ({
        'Block': record.property_block,
        'Lot': record.property_lot,
        'Property Class': record.property_m4_class,
        'Location': record.property_location,
        'Owner': record.owner_name,
        'Mailing Address': `${record.owner_street} ${record.owner_csz}`.trim()
      }));
      
      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Mailing List');
      
      // Auto-size columns
      const colWidths = [
        { wch: 10 }, // Block
        { wch: 10 }, // Lot
        { wch: 15 }, // Property Class
        { wch: 30 }, // Location
        { wch: 25 }, // Owner
        { wch: 35 }  // Mailing Address
      ];
      ws['!cols'] = colWidths;
      
      // Generate Excel file and download
      XLSX.writeFile(wb, `${jobData.job_name}_Initial_Mailing_List.xlsx`);
      
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
      
      const refusalCategories = jobConfig?.infoby_category_config?.refusal_categories || [];
      console.log('📋 Refusal categories:', refusalCategories);
      
      // Get ALL property records with pagination
      const propertyData = await getAllPropertyRecords(jobData.id);
      
      // Get ALL inspection data with pagination
      const inspectionData = await getAllInspectionData(jobData.id);
      
      // Create a map of inspection data by property key (block-lot)
      const inspectionMap = new Map();
      inspectionData.forEach(inspection => {
        const key = `${inspection.property_block}-${inspection.property_lot}`;
        inspectionMap.set(key, inspection);
      });
      
      // Filter properties for 2nd attempt
      const secondAttemptProperties = propertyData.filter(property => {
        const propClass = property.property_m4_class?.toUpperCase() || '';
        const propertyKey = `${property.property_block}-${property.property_lot}`;
        const inspection = inspectionMap.get(propertyKey);
        
        // Check if it's a refusal based on job config
        if (inspection && refusalCategories.includes(inspection.inspection_info_by)) {
          return true;
        }
        
        // Check if it's class 2 or 3A with no inspection
        if (['2', '3A'].includes(propClass)) {
          const hasInspection = property.inspection_info_by || inspection?.inspection_info_by;
          if (!hasInspection || hasInspection.trim() === '') {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`✅ Found ${secondAttemptProperties.length} properties for 2nd attempt`);
      
      // Transform data for Excel
      const excelData = secondAttemptProperties.map(property => ({
        'Block': property.property_block,
        'Lot': property.property_lot,
        'Property Class': property.property_m4_class,
        'Location': property.property_location,
        'Owner': property.owner_name,
        'Mailing Address': `${property.owner_street} ${property.owner_csz}`.trim(),
        'Reason': inspectionMap.get(`${property.property_block}-${property.property_lot}`)?.inspection_info_by || 'Not Inspected'
      }));
      
      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '2nd Attempt Mailer');
      
      // Auto-size columns
      const colWidths = [
        { wch: 10 }, // Block
        { wch: 10 }, // Lot
        { wch: 15 }, // Property Class
        { wch: 30 }, // Location
        { wch: 25 }, // Owner
        { wch: 35 }, // Mailing Address
        { wch: 20 }  // Reason
      ];
      ws['!cols'] = colWidths;
      
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
      
      const refusalCategories = jobConfig?.infoby_category_config?.refusal_categories || [];
      
      // Get ALL property records with pagination
      const propertyData = await getAllPropertyRecords(jobData.id);
      
      // Get ALL inspection data with pagination
      const inspectionData = await getAllInspectionData(jobData.id);
      
      // Create a map of inspection data by composite key
      const inspectionMap = new Map();
      inspectionData.forEach(inspection => {
        // Use the existing composite key from the database
        if (inspection.property_composite_key) {
          inspectionMap.set(inspection.property_composite_key, inspection);
        }
      });
      
      // Filter properties for 3rd attempt (same logic as 2nd for now)
      const thirdAttemptProperties = propertyData.filter(property => {
        const propClass = property.property_m4_class?.toUpperCase() || '';
        // Use the property's composite key to find matching inspection
        const inspection = property.property_composite_key ? 
          inspectionMap.get(property.property_composite_key) : null;
        
        // Check if it's a refusal based on job config
        if (inspection && refusalCategories.includes(inspection.info_by_code)) {
          return true;
        }
        
        // Check if it's class 2 or 3A with no inspection
        if (['2', '3A'].includes(propClass)) {
          const hasInspection = property.inspection_info_by || inspection?.info_by_code;
          if (!hasInspection || hasInspection.trim() === '') {
            return true;
          }
        }
        
        return false;
      });
      
      console.log(`✅ Found ${thirdAttemptProperties.length} properties for 3rd attempt`);
      
      // Transform data for Excel
      const excelData = thirdAttemptProperties.map(property => ({
        'Block': property.property_block,
        'Lot': property.property_lot,
        'Property Class': property.property_m4_class,
        'Location': property.property_location,
        'Owner': property.owner_name,
        'Mailing Address': `${property.owner_street} ${property.owner_csz}`.trim(),
        'Reason': property.property_composite_key && inspectionMap.get(property.property_composite_key)?.info_by_code || 'Not Inspected'
      }));
      
      // Create workbook and worksheet
      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '3rd Attempt Mailer');
      
      // Auto-size columns
      const colWidths = [
        { wch: 10 }, // Block
        { wch: 10 }, // Lot
        { wch: 15 }, // Property Class
        { wch: 30 }, // Location
        { wch: 25 }, // Owner
        { wch: 35 }, // Mailing Address
        { wch: 20 }  // Reason
      ];
      ws['!cols'] = colWidths;
      
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
      // First update the item status
      await handleItemStatusChange(itemId, 'completed');
      
      // Then show archive confirmation
      setShowArchiveConfirm(true);
    }
  };

  const downloadFile = async (filePath, fileName) => {
    try {
      // Get public URL for the file
      const { data } = supabase.storage
        .from('checklist-documents')
        .getPublicUrl(filePath);
      
      if (data?.publicUrl) {
        // Open in new tab or trigger download
        window.open(data.publicUrl, '_blank');
      } else {
        throw new Error('Could not get file URL');
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Failed to download file. Please try again.');
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

  // Navigate to analysis section (placeholder - implement based on your navigation)
  const navigateToAnalysisSection = (sectionName) => {
    console.log(`Navigate to analysis section: ${sectionName}`);
    // TODO: Implement navigation to the specific analysis component
    // This might use onSubModuleChange or a router
    alert(`This will navigate to the ${sectionName} section when implemented`);
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
                  onClick={() => setChecklistType('revaluation')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    checklistType === 'revaluation' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-white border border-blue-300 text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  🏢 Revaluation
                </button>
                <button
                  onClick={() => setChecklistType('reassessment')}
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
                  {checklistItems.filter(item => item.client_approved === true).length}
                </p>
              </div>
              <UserCheck className="w-8 h-8 text-purple-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              of {checklistItems.filter(item => item.requires_client_approval).length} required
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Files Uploaded</p>
                <p className="text-2xl font-bold text-orange-600">
                  {checklistItems.filter(item => item.file_attachment_path && validFiles[item.id]).length}
                </p>
              </div>
              <Upload className="w-8 h-8 text-orange-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              of {checklistItems.filter(item => item.allows_file_upload).length} allowed
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

          return (
            <div key={item.id} className={`bg-white border rounded-lg p-4 hover:shadow-md transition-shadow ${
              item.status === 'completed' ? 'border-green-200 bg-green-50' : 'border-gray-200'
            }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg bg-${categoryColor}-100`}>
                    <CategoryIcon className={`w-5 h-5 text-${categoryColor}-600`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-800">{item.item_text}</h3>
                      {/* Analysis items show sync badge instead of auto-update */}
                      {item.is_analysis_item && (
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
                    {item.client_approved === true && item.client_approved_at && (
                      <div className="text-sm text-purple-600 bg-purple-50 px-2 py-1 rounded mb-2 inline-block">
                        ✓ Client approved on {new Date(item.client_approved_at).toLocaleDateString()} by {item.client_approved_by || 'Unknown'}
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
                                <span>{doc.file_name || doc.file_path.split('/').pop()}</span>
                                <ExternalLink 
                                  className="w-4 h-4 cursor-pointer hover:text-blue-800" 
                                  onClick={() => downloadFile(doc.file_path, doc.file_name || doc.file_path.split('/').pop())}
                                />
                              </div>
                            ))
                          ) : (
                            // Fallback to single file display
                            <div className="flex items-center gap-2 text-sm text-blue-600">
                              <FileText className="w-4 h-4" />
                              <span>{item.file_attachment_path.split('/').pop()}</span>
                              <ExternalLink 
                                className="w-4 h-4 cursor-pointer hover:text-blue-800" 
                                onClick={() => downloadFile(item.file_attachment_path, item.file_attachment_path.split('/').pop())}
                              />
                            </div>
                          )
                        ) : (
                          // Single file display for other items
                          <div className="flex items-center gap-2 text-sm text-blue-600">
                            <FileText className="w-4 h-4" />
                            <span>{item.file_attachment_path.split('/').pop()}</span>
                            <ExternalLink 
                              className="w-4 h-4 cursor-pointer hover:text-blue-800" 
                              onClick={() => downloadFile(item.file_attachment_path, item.file_attachment_path.split('/').pop())}
                            />
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
                  {/* Don't show Mark Complete button for analysis items that sync from other components */}
                  {!item.is_analysis_item && (
                    <button
                      onClick={() => handleItemStatusChange(item.id, 
                        item.status === 'completed' ? 'pending' : 'completed'
                      )}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        item.status === 'completed'
                          ? 'bg-green-500 text-white hover:bg-green-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {item.status === 'completed' ? 'Completed' : 'Mark Complete'}
                    </button>
                  )}
                  
                  {/* Show Go to Section button for analysis items */}
                  {item.is_analysis_item && (
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
                  {item.special_action === 'generate_turnover_pdf' && (
                    <button className="px-3 py-1 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 flex items-center gap-1">
                      <Printer className="w-4 h-4" />
                      Generate PDF
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
