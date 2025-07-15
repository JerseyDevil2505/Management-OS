import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Users, 
  Calendar, 
  FileText, 
  Settings, 
  Database,
  Plus,
  Edit3,
  Trash2,
  ArrowLeft,
  Download,
  Upload,
  Filter,
  Search,
  Eye,
  UserCheck,
  Building,
  MapPin,
  Mail,
  FileCheck,
  Target,
  ExternalLink,
  FileUp,
  CheckSquare,
  Square,
  FileDown,
  Printer,
  Archive,
  Save
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const ManagementChecklist = ({ 
  jobData, 
  onBackToJobs, 
  activeSubModule = 'checklist',
  onSubModuleChange 
}) => {
  // jobData should include: job_name, client_name, assigned_manager (UUID), end_date, manager_name (from join)
  const [editableClientName, setEditableClientName] = useState(jobData?.client_name || '');
  const [hasClientNameChanges, setHasClientNameChanges] = useState(false);
  const [dbConnected, setDbConnected] = useState(true);
  const [checklistType, setChecklistType] = useState('revaluation');
  const [checklistItems, setChecklistItems] = useState([]);
  const [filterCategory, setFilterCategory] = useState('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [asOfDate, setAsOfDate] = useState('2025-07-15'); // General checklist updates
  const [sourceFileDate, setSourceFileDate] = useState('2025-06-01'); // From Production Tracker
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [mailingListPreview, setMailingListPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const fileInputRef = useRef();

  // Extract year from end_date for display
  const dueYear = jobData?.end_date ? new Date(jobData.end_date).getFullYear() : 'TBD';

  // Get current user info from Supabase Auth
  useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUser({
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || user.email.split('@')[0] || 'User'
          });
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    
    getCurrentUser();
  }, []);

  // Mock checklist data will be replaced with database calls
  const [checklistItems, setChecklistItems] = useState([]);

  useEffect(() => {
    if (jobData) {
      // TODO: Replace with actual database call to load checklist items for this job
      // const items = await checklistService.getItemsForJob(jobData.id);
      // setChecklistItems(items);
      
      // For now, load empty checklist from template
      loadChecklistTemplate();
    }
  }, [jobData, checklistType]);

  const loadChecklistTemplate = async () => {
    try {
      // TODO: Replace with actual Supabase call
      // const template = await checklistService.getTemplate('revaluation');
      // const jobChecklist = await checklistService.createJobChecklist(jobData.id, template.id);
      // setChecklistItems(jobChecklist.items);
      
      // Temporary: Empty checklist for development
      setChecklistItems([]);
    } catch (error) {
      console.error('Error loading checklist template:', error);
      setChecklistItems([]);
    }
  };

  useEffect(() => {
    setHasClientNameChanges(editableClientName !== jobData?.client_name);
  }, [editableClientName, jobData?.client_name]);

  const saveClientName = () => {
    // TODO: Replace with actual database update
    // await jobService.updateClientName(jobData.id, editableClientName);
    console.log('Saving client name:', editableClientName);
    setHasClientNameChanges(false);
    alert('Client/Assessor name updated successfully!');
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

  const completedCount = checklistItems.filter(item => item.status === 'completed').length;
  const totalCount = checklistItems.length;
  const completionPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleItemStatusChange = (itemId, newStatus) => {
    setChecklistItems(items => items.map(item => 
      item.id === itemId 
        ? { 
            ...item, 
            status: newStatus, 
            completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
            completed_by: newStatus === 'completed' ? 'System User' : null // TODO: Get actual user name from auth
          }
        : item
    ));
    
    // TODO: Update database
    // await checklistService.updateItemStatus(itemId, newStatus);
  };

  const handleClientApproval = (itemId, approved) => {
    setChecklistItems(items => items.map(item => 
      item.id === itemId 
        ? { 
            ...item, 
            client_approved: approved,
            client_approved_date: approved ? new Date().toISOString() : null,
            client_approved_by: approved ? 'System User' : null // TODO: Get actual user name from auth
          }
        : item
    ));
    
    // TODO: Update database
    // await checklistService.updateClientApproval(itemId, approved);
  };

  const handleFileUpload = async (itemId, file) => {
    if (file.size > 200 * 1024 * 1024) { // 200MB limit
      alert('File size exceeds 200MB limit');
      return;
    }
    
    setUploading(true);
    try {
      // TODO: Replace with actual Supabase Storage upload
      // const filePath = await storageService.uploadFile(file, 'checklist-attachments');
      
      // Simulate upload delay for now
      setTimeout(() => {
        setChecklistItems(items => items.map(item => 
          item.id === itemId 
            ? { 
                ...item, 
                file_attachment_path: `/uploads/${file.name}`, // TODO: Use actual uploaded file path
                file_size: `${(file.size / 1024 / 1024).toFixed(1)}MB`,
                status: 'completed',
                completed_at: new Date().toISOString(),
                completed_by: 'System User' // TODO: Get actual user name from auth
              }
            : item
        ));
        setUploading(false);
      }, 1000);
      
      // TODO: Update database with file info
      // await checklistService.updateItemFile(itemId, filePath, file.size);
    } catch (error) {
      console.error('File upload error:', error);
      alert('Error uploading file: ' + error.message);
      setUploading(false);
    }
  };

  const generateMailingList = () => {
    // TODO: Replace with actual data from source files/property records
    // const properties = await propertyService.getPropertiesForJob(jobData.id);
    // const mailingData = properties.map(prop => ({
    //   block: prop.block,
    //   lot: prop.lot, 
    //   location: prop.property_location,
    //   owner: prop.owner_name,
    //   address: prop.mailing_address
    // }));
    
    // Temporary mock data for development
    const mockMailingData = [
      { block: '1', lot: '1', location: 'Property data will come from source files', owner: 'Owner data from property records', address: 'Mailing addresses from normalized data' }
    ];
    setMailingListPreview(mockMailingData);
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

  const handleTurnoverDate = (date) => {
    if (date) {
      setShowArchiveConfirm(true);
    }
  };

  const confirmArchive = () => {
    // Update turnover date item
    setChecklistItems(items => items.map(item => 
      item.id === 29 
        ? { 
            ...item, 
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_by: 'Current User',
            notes: 'Job marked for archive'
          }
        : item
    ));
    setShowArchiveConfirm(false);
    alert('Job will be archived and moved to completed status in Job Management');
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
          {/* Left Column - Job Details */}
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
                <span className="text-sm text-gray-600">{jobData.manager_name || 'Not assigned'}</span>
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

          {/* Right Column - Project Type & Dates */}
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
                {/* Left side - Item info */}
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg bg-${categoryColor}-100`}>
                    <CategoryIcon className={`w-5 h-5 text-${categoryColor}-600`} />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-800">{item.item_text}</h3>
                      {item.auto_completed && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          Auto-completed
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

                    {/* Completion info */}
                    {item.completed_at && (
                      <div className="text-sm text-gray-500 mb-2">
                        Completed on {new Date(item.completed_at).toLocaleDateString()} by {item.completed_by}
                      </div>
                    )}

                    {/* File attachment */}
                    {item.file_attachment_path && (
                      <div className="flex items-center gap-2 text-sm text-blue-600 mb-2">
                        <FileText className="w-4 h-4" />
                        <span>{item.file_attachment_path.split('/').pop()}</span>
                        {item.file_size && <span className="text-gray-500">({item.file_size})</span>}
                        <ExternalLink className="w-4 h-4 cursor-pointer hover:text-blue-800" />
                      </div>
                    )}

                    {/* Notes */}
                    {item.notes && (
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded mt-2">
                        <strong>Notes:</strong> {item.notes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side - Actions */}
                <div className="flex flex-col gap-2 ml-4">
                  {/* Status toggle */}
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

                  {/* Client approval */}
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

                  {/* File upload */}
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

                  {/* Special actions */}
                  {item.id === 9 && (
                    <button
                      onClick={generateMailingList}
                      className="px-3 py-1 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 flex items-center gap-1"
                    >
                      <Mail className="w-4 h-4" />
                      Generate List
                    </button>
                  )}

                  {item.id === 28 && (
                    <button
                      className="px-3 py-1 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 flex items-center gap-1"
                    >
                      <Printer className="w-4 h-4" />
                      Generate PDF
                    </button>
                  )}

                  {item.id === 29 && (
                    <input
                      type="date"
                      onChange={(e) => handleTurnoverDate(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded-md text-sm"
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
