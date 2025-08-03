import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle, Clock, AlertCircle, Users, Calendar, FileText, Settings, Database, Plus, Edit3, Trash2, ArrowLeft, Download, Upload, Filter, Search, Eye, UserCheck, Building, MapPin, Mail, FileCheck, Target, ExternalLink, FileUp, CheckSquare, Square, FileDown, Printer, Archive, Save
} from 'lucide-react';
import { supabase, checklistService } from '../../lib/supabaseClient';

const ManagementChecklist = ({ jobData, onBackToJobs, activeSubModule = 'checklist', onSubModuleChange }) => {
  const [editableClientName, setEditableClientName] = useState(jobData?.client_name || '');
  const [hasClientNameChanges, setHasClientNameChanges] = useState(false);
  const [checklistType, setChecklistType] = useState('revaluation');
  const [checklistItems, setChecklistItems] = useState([]);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [asOfDate, setAsOfDate] = useState('2025-07-15');
  const [sourceFileDate, setSourceFileDate] = useState('2025-06-01');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [mailingListPreview, setMailingListPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const fileInputRef = useRef();

  const dueYear = jobData?.end_date ? new Date(jobData.end_date).getFullYear() : 'TBD';

  useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUser({
            id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
            email: 'ppalead1@gmail.com',
            name: 'Jim Duda'
          });
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, []);

  useEffect(() => {
    if (jobData) {
      // Always start with the 29 template items
      const templateItems = [
        // Setup Category (1-8)
        { id: 1, item_order: 1, item_text: 'Contract Signed by Client', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 2, item_order: 2, item_text: 'Contract Signed/Approved by State', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 3, item_order: 3, item_text: 'Tax Maps Approved', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 4, item_order: 4, item_text: 'Tax Map Upload', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false },
        { id: 5, item_order: 5, item_text: 'Zoning Map Upload', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false },
        { id: 6, item_order: 6, item_text: 'Zoning Bulk and Use Regulations Upload', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false },
        { id: 7, item_order: 7, item_text: 'PPA Website Updated', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 8, item_order: 8, item_text: 'Data Collection Parameters', category: 'setup', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: true, allows_file_upload: false, client_approved: false },
        
        // Inspection Category (9-14)
        { id: 9, item_order: 9, item_text: 'Initial Mailing List', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, special_action: 'generate_mailing_list' },
        { id: 10, item_order: 10, item_text: 'Initial Letter and Brochure', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false, special_action: 'generate_letter' },
        { id: 11, item_order: 11, item_text: 'Initial Mailing Sent', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 12, item_order: 12, item_text: 'First Attempt Inspections', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, auto_update_source: 'production_tracker' },
        { id: 13, item_order: 13, item_text: 'Second Attempt Inspections', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, special_action: 'generate_second_attempt_mailer' },
        { id: 14, item_order: 14, item_text: 'Third Attempt Inspections', category: 'inspection', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, special_action: 'generate_third_attempt_mailer' },
        
        // Analysis Category (15-26)
        { id: 15, item_order: 15, item_text: 'Market Analysis', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false },
        { id: 16, item_order: 16, item_text: 'Page by Page Analysis', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 17, item_order: 17, item_text: 'Lot Sizing Completed', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 18, item_order: 18, item_text: 'Lot Sizing Questions Complete', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 19, item_order: 19, item_text: 'VCS Reviewed/Reset', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 20, item_order: 20, item_text: 'Land Value Tables Built', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 21, item_order: 21, item_text: 'Land Values Entered', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: true, allows_file_upload: false, client_approved: false },
        { id: 22, item_order: 22, item_text: 'Economic Obsolescence Study', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: true, allows_file_upload: false, client_approved: false },
        { id: 23, item_order: 23, item_text: 'Cost Conversion Factor Set', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: true, allows_file_upload: false, client_approved: false },
        { id: 24, item_order: 24, item_text: 'Building Class Review/Updated', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 25, item_order: 25, item_text: 'Effective Age Loaded/Set', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        { id: 26, item_order: 26, item_text: 'Final Values Ready', category: 'analysis', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false },
        
        // Completion Category (27-29)
        { id: 27, item_order: 27, item_text: 'View Value Mailer', category: 'completion', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: true, client_approved: false, special_action: 'view_impact_letter' },
        { id: 28, item_order: 28, item_text: 'Generate Turnover Document', category: 'completion', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, special_action: 'generate_turnover_pdf' },
        { id: 29, item_order: 29, item_text: 'Turnover Date', category: 'completion', status: 'pending', completed_at: null, completed_by: null, requires_client_approval: false, allows_file_upload: false, client_approved: false, input_type: 'date', special_action: 'archive_trigger' }
      ];
      
      setChecklistItems(templateItems);
      
      // Then try to load saved status from database
      loadChecklistItemStatus();
    }
  }, [jobData, checklistType]);

  // Load checklist item status from database (if exists)
  const loadChecklistItemStatus = async () => {
    try {
      console.log('📋 Loading checklist status for job:', jobData.id);
      
      // Try to load existing status from database
      const savedItems = await checklistService.getChecklistItems(jobData.id);
      
      if (savedItems && savedItems.length > 0) {
        console.log('✅ Found saved checklist status, updating...');
        
        // Update the template items with saved status
        setChecklistItems(currentItems => 
          currentItems.map(templateItem => {
            const savedItem = savedItems.find(s => s.item_order === templateItem.item_order);
            if (savedItem) {
              return {
                ...templateItem,
                status: savedItem.status || 'pending',
                completed_at: savedItem.completed_at,
                completed_by: savedItem.completed_by,
                client_approved: savedItem.client_approved || false,
                client_approved_date: savedItem.client_approved_date,
                client_approved_by: savedItem.client_approved_by,
                file_attachment_path: savedItem.file_attachment_path,
                notes: savedItem.notes
              };
            }
            return templateItem;
          })
        );
      } else {
        console.log('📋 No saved checklist status found, using defaults');
      }
    } catch (error) {
      console.error('Error loading checklist status:', error);
      // Keep the default template if there's an error
    }
  };

  useEffect(() => {
    setHasClientNameChanges(editableClientName !== jobData?.client_name);
  }, [editableClientName, jobData?.client_name]);

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
        currentUser?.name || 'System User'
      );
      
      // Then update local state with the response
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? updatedItem : item
      ));
      
      console.log(`✅ Updated item ${itemId} status to ${newStatus}`);
    } catch (error) {
      console.error('Error updating item status:', error);
      alert('Failed to update status. Please try again.');
    }
  };

  const handleClientApproval = async (itemId, approved) => {
    try {
      // Update in database first
      const updatedItem = await checklistService.updateClientApproval(
        itemId, 
        approved, 
        currentUser?.name || 'System User'
      );
      
      // Then update local state with the response
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? updatedItem : item
      ));
      
      console.log(`✅ Updated item ${itemId} client approval to ${approved}`);
    } catch (error) {
      console.error('Error updating client approval:', error);
      alert('Failed to update approval. Please try again.');
    }
  };

  const handleFileUpload = async (itemId, file) => {
    if (file.size > 200 * 1024 * 1024) {
      alert('File size exceeds 200MB limit');
      return;
    }
    
    setUploading(true);
    try {
      // Upload file and update item
      const updatedItem = await checklistService.uploadFile(itemId, jobData.id, file, currentUser?.name || 'System User');
      
      // Update local state
      setChecklistItems(items => items.map(item => 
        item.id === itemId ? updatedItem : item
      ));
      
      alert('File uploaded successfully!');
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const saveClientName = async () => {
    try {
      console.log('Saving client name:', editableClientName);
      
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

  const generateMailingList = async () => {
    try {
      const mailingData = await checklistService.generateMailingList(jobData.id);
      
      // Transform data for display
      const formattedData = mailingData.map(record => ({
        block: record.property_block,
        lot: record.property_lot,
        location: record.property_location,
        owner: record.owner_name,
        address: record.owner_address
      }));
      
      setMailingListPreview(formattedData);
    } catch (error) {
      console.error('Error generating mailing list:', error);
      alert('Failed to generate mailing list. Please ensure property data is loaded.');
    }
  };

  const downloadMailingList = () => {
    const csvContent = [
      ['Block', 'Lot', 'Location', 'Owner', 'Mailing Address'],
      ...mailingListPreview.map(item => [item.block, item.lot, item.location, item.owner, item.address])
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
                <span className="text-sm text-gray-600">{asOfDate}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-32">Source File Date:</label>
                <span className="text-sm text-gray-600">{sourceFileDate}</span>
                <span className="text-xs text-gray-500">(from Production Tracker)</span>
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
                  {checklistItems.filter(item => item.file_attachment_path).length}
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
                      <span className={`px-2 py-1 bg-${categoryColor}-100 text-${categoryColor}-700 rounded-full text-xs`}>
                        {item.category}
                      </span>
                      <span className={`px-2 py-1 bg-${statusColor}-100 text-${statusColor}-700 rounded-full text-xs`}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                    {item.completed_at && (
                      <div className="text-sm text-gray-500 mb-2">
                        Completed on {new Date(item.completed_at).toLocaleDateString()} by {item.completed_by}
                      </div>
                    )}
                    {item.file_attachment_path && (
                      <div className="flex items-center gap-2 text-sm text-blue-600 mb-2">
                        <FileText className="w-4 h-4" />
                        <span>{item.file_attachment_path.split('/').pop()}</span>
                        {item.file_size && <span className="text-gray-500">({item.file_size})</span>}
                        <ExternalLink className="w-4 h-4 cursor-pointer hover:text-blue-800" />
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
                    <div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => {
                          if (e.target.files[0]) {
                            handleFileUpload(item.id, e.target.files[0]);
                          }
                        }}
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-1"
                      >
                        <Upload className="w-4 h-4" />
                        {uploading ? 'Uploading...' : 'Upload File'}
                      </button>
                    </div>
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
                  {item.special_action === 'generate_letter' && (
                    <button className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      Generate Letter
                    </button>
                  )}
                  {item.special_action === 'generate_second_attempt_mailer' && (
                    <button className="px-3 py-1 bg-yellow-500 text-white rounded-md text-sm hover:bg-yellow-600 flex items-center gap-1">
                      <Mail className="w-4 h-4" />
                      2nd Attempt Mailer
                    </button>
                  )}
                  {item.special_action === 'generate_third_attempt_mailer' && (
                    <button className="px-3 py-1 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 flex items-center gap-1">
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
