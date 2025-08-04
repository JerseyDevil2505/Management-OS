import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle, Clock, AlertCircle, Users, Calendar, FileText, Settings, Database, 
  Plus, Edit3, Trash2, ArrowLeft, Download, Upload, Filter, Search, Eye, UserCheck, 
  Building, MapPin, Mail, FileCheck, Target, ExternalLink, FileUp, CheckSquare, 
  Square, FileDown, Printer, Archive, Save
} from 'lucide-react';
import { supabase, checklistService } from '../../lib/supabaseClient';

const ManagementChecklist = ({ jobData, onBackToJobs, activeSubModule = 'checklist', onSubModuleChange }) => {
  const [editableClientName, setEditableClientName] = useState(jobData?.client_name || '');
  const [editableAssessorEmail, setEditableAssessorEmail] = useState(jobData?.assessor_email || '');
  const [hasClientNameChanges, setHasClientNameChanges] = useState(false);
  const [hasAssessorEmailChanges, setHasAssessorEmailChanges] = useState(false);
  const [checklistType, setChecklistType] = useState('revaluation');
  const [checklistItems, setChecklistItems] = useState([]);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [mailingListPreview, setMailingListPreview] = useState(null);
  const [uploadingItems, setUploadingItems] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [validFiles, setValidFiles] = useState({}); // Track which files actually exist
  const [checklistDocuments, setChecklistDocuments] = useState({}); // Track multiple documents per item

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
    const getCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Using your UUID for now
          setCurrentUser({
            id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
            email: 'ppalead1@gmail.com',
            name: 'Jim Duda'
          });
        }
      } catch (error) {
        console.error('Error getting current user:', error);
        // Fallback to your UUID
        setCurrentUser({
          id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
          email: 'ppalead1@gmail.com',
          name: 'Jim Duda'
        });
      }
    };
    getCurrentUser();
  }, []);

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

  // Load checklist items from database
  const loadChecklistItems = async () => {
    try {
      setIsLoadingItems(true);
      
      // First, try to load existing items from checklist_items
      let items = await checklistService.getChecklistItems(jobData.id);
      
      // If no items exist, create them from template
      if (!items || items.length === 0) {
        
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
          template_item_id: templateItem.id, // NOW WE SET THIS!
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
        // Add special actions based on item text
        if (item.item_text === 'Initial Mailing List') {
          item.special_action = 'generate_mailing_list';
        } else if (item.item_text === 'Initial Letter and Brochure') {
          item.special_action = 'generate_brochure';
        } else if (item.item_text === 'Second Attempt Inspections') {
          item.special_action = 'generate_second_attempt_mailer';
        } else if (item.item_text === 'Third Attempt Inspections') {
          item.special_action = 'generate_third_attempt_mailer';
        } else if (item.item_text === 'View Value Mailer') {
          item.special_action = 'view_impact_letter';
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
    setHasClientNameChanges(editableClientName !== jobData?.client_name);
  }, [editableClientName, jobData?.client_name]);

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
      // Update in database first - PASS UUID NOT NAME!
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
      // Update in database first - PASS UUID NOT NAME!
      const updatedItem = await checklistService.updateClientApproval(
        itemId, 
        approved, 
        currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      );
      
      // Then update local state with the response
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? { ...item, ...updatedItem } : item
      ));

    } catch (error) {
      console.error('Error updating client approval:', error);
      alert('Failed to update approval. Please try again.');
    }
  };

  // NEW APPROACH: Direct file handler without hidden inputs
  const handleFileSelect = async (itemId, itemText) => {
    console.log(`📁 Opening file selector for item: ${itemText} (ID: ${itemId})`);
    
    // Create file input programmatically
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg';
    fileInput.multiple = item.item_text === 'Initial Letter and Brochure'; // Allow multiple for this item
    
    fileInput.onchange = async (event) => {
      const files = Array.from(event.target.files);
      if (!files.length) return;
      
      // Handle multiple files for Initial Letter and Brochure
      if (item.item_text === 'Initial Letter and Brochure' && files.length > 1) {
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
    };
    
    // Trigger file selection
    fileInput.click();
  };

  const saveClientName = async () => {
    try {
      // Save to database
      await checklistService.updateClientName(jobData.id, editableClientName);
      
      // Update local state
      setHasClientNameChanges(false);
      
      // Success feedback
      alert('Client/Assessor name updated successfully!');
    } catch (error) {
      console.error('Error saving client name:', error);
      alert('Failed to save client name. Please try again.');
    }
  };

  const saveAssessorEmail = async () => {
    try {
      // Save to database
      await checklistService.updateAssessorEmail(jobData.id, editableAssessorEmail);
      
      // Update local state
      setHasAssessorEmailChanges(false);
      
      // Success feedback
      alert('Assessor email updated successfully!');
    } catch (error) {
      console.error('Error saving assessor email:', error);
      alert('Failed to save assessor email. Please try again.');
    }
  };

  const generateMailingList = async () => {
    try {
      const mailingData = await checklistService.generateMailingList(jobData.id);
      
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
      
      // Transform data for display
      const formattedData = filteredData.map(record => ({
        block: record.property_block,
        lot: record.property_lot,
        propertyClass: record.property_m4_class,
        location: record.property_location,
        owner: record.owner_name,
        address: `${record.owner_street} ${record.owner_csz}`.trim()
      }));
      
      setMailingListPreview(formattedData);
    } catch (error) {
      console.error('Error generating mailing list:', error);
      alert('Failed to generate mailing list. Please ensure property data is loaded.');
    }
  };

  const downloadMailingList = () => {
    const csvContent = [
      ['Block', 'Lot', 'Class', 'Location', 'Owner', 'Mailing Address'],
      ...mailingListPreview.map(item => [item.block, item.lot, item.propertyClass, item.location, item.owner, item.address])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${jobData.job_name}_mailing_list.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMailingListPreview(null);
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
                <label className="text-sm font-medium text-gray-700 w-32">Client/Assessor:</label>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={editableClientName}
                    onChange={(e) => setEditableClientName(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm flex-1"
                    placeholder="Enter client/assessor name"
                  />
                  {hasClientNameChanges && (
                    <button
                      onClick={saveClientName}
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
                  {checklistItems.filter(item => item.client_approved).length}
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
                      {item.auto_update_source && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          Auto-update from {item.auto_update_source}
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
                        Completed on {new Date(item.completed_at).toLocaleDateString()} by {item.completed_by}
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
                  {item.requires_client_approval && (
                    <button
                      onClick={() => handleClientApproval(item.id, !item.client_approved)}
                      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                        item.client_approved
                          ? 'bg-purple-500 text-white hover:bg-purple-600'
                          : 'bg-purple-200 text-purple-700 hover:bg-purple-300'
                      }`}
                    >
                      {item.client_approved ? '✓ Client Approved' : 'Client Approval'}
                    </button>
                  )}
                  {item.allows_file_upload && (
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
                      onClick={generateMailingList}
                      className="px-3 py-1 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 flex items-center gap-1"
                    >
                      <Mail className="w-4 h-4" />
                      Generate List
                    </button>
                  )}
                  {item.special_action === 'generate_brochure' && (
                    <button className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      Generate Brochure
                    </button>
                  )}
                  {item.special_action === 'generate_second_attempt_mailer' && (
                    <button className="px-3 py-1 bg-yellow-500 text-white rounded-md text-sm hover:bg-yellow-600 flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      2nd Attempt Mailer
                    </button>
                  )}
                  {item.special_action === 'generate_third_attempt_mailer' && (
                    <button className="px-3 py-1 bg-red-500 text-white rounded-md text-sm hover:bg-red-600 flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      3rd Attempt Mailer
                    </button>
                  )}
                  {item.special_action === 'view_impact_letter' && (
                    <button className="px-3 py-1 bg-purple-500 text-white rounded-md text-sm hover:bg-purple-600 flex items-center gap-1">
                      <Eye className="w-4 h-4" />
                      View Mailer
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

      {/* Mailing List Preview Modal */}
      {mailingListPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-96 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Initial Mailing List Preview</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 p-2 text-left">Block</th>
                    <th className="border border-gray-300 p-2 text-left">Lot</th>
                    <th className="border border-gray-300 p-2 text-left">Class</th>
                    <th className="border border-gray-300 p-2 text-left">Location</th>
                    <th className="border border-gray-300 p-2 text-left">Owner</th>
                    <th className="border border-gray-300 p-2 text-left">Mailing Address</th>
                  </tr>
                </thead>
                <tbody>
                  {mailingListPreview.map((item, index) => (
                    <tr key={index}>
                      <td className="border border-gray-300 p-2">{item.block}</td>
                      <td className="border border-gray-300 p-2">{item.lot}</td>
                      <td className="border border-gray-300 p-2">{item.propertyClass}</td>
                      <td className="border border-gray-300 p-2">{item.location}</td>
                      <td className="border border-gray-300 p-2">{item.owner}</td>
                      <td className="border border-gray-300 p-2">{item.address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-4 mt-4">
              <button
                onClick={() => setMailingListPreview(null)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={downloadMailingList}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}

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
