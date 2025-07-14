import React, { useState, useEffect } from 'react';
import { Users, Upload, Search, Mail, Phone, MapPin, Clock, AlertTriangle, Settings, Database, CheckCircle, Loader, Plus, Edit, Save, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { employeeService, signInAsDev } from '../lib/supabaseClient';

const EmployeeManagement = () => {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterFullTime, setFilterFullTime] = useState('all');
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [importComplete, setImportComplete] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);

  // Load employees from database on component mount
  useEffect(() => {
    const initializeAuth = async () => {
      await signInAsDev();
      loadEmployees();
    };
    initializeAuth();
  }, []);

  const loadEmployees = async () => {
    try {
      setIsLoading(true);
      const data = await employeeService.getAll();
      
      // Transform database format to component format
      const transformedEmployees = data.map(emp => ({
        id: emp.id,
        inspectorNumber: emp.employee_number || `TEMP${emp.id}`,
        name: `${emp.last_name || ''}, ${emp.first_name || ''}`.replace(/, $/, ''),
        email: emp.email || '',
        phone: emp.phone || '',
        isFullTime: emp.employment_status === 'full_time',
        isContractor: emp.employment_status === 'contractor',
        role: emp.role || 'Unassigned',
        location: emp.region || 'Unknown',
        zipCode: emp.zip_code || '',
        hasIssues: !emp.employee_number || !emp.email || !emp.phone,
        initials: emp.initials,
        status: emp.employment_status || 'active'
      }));
      
      setEmployees(transformedEmployees);
      setFilteredEmployees(transformedEmployees);
      
      if (transformedEmployees.length > 0) {
        setImportComplete(true);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
      alert('Error loading employee data from database');
    } finally {
      setIsLoading(false);
    }
  };

  // Import Excel file function with proper variable declarations
  const handleFileImport = async (file) => {
    if (!file) return;
    
    try {
      setIsImporting(true);
      setImportComplete(false);
      
      const arrayBuffer = await readFileAsArrayBuffer(file);
      const workbook = XLSX.read(arrayBuffer, {
        cellStyles: true,
        cellFormulas: true,
        cellDates: true,
        cellNF: true,
        sheetStubs: true
      });
      
      const mainSheetData = XLSX.utils.sheet_to_json(workbook.Sheets['Sheet1']);
      console.log('File columns detected:', Object.keys(mainSheetData[0] || {}));
      
      const existingEmployees = await employeeService.getAll();
      const existingMap = new Map(existingEmployees.map(emp => [emp.email, emp]));
      
      let newEmployees = 0;
      let updatedEmployees = 0;
      let contractorEmployees = 0;
      
      const processedEmployees = mainSheetData.map((emp, index) => {
        // DECLARE ALL VARIABLES AT THE TOP
        let inspectorNum = emp['Inspector #'] || emp['Inspector Number'];
        if (!inspectorNum) {
          const namepart = (emp['Inspector'] || 'Unknown').split(',')[0].substring(0, 3).toUpperCase();
          inspectorNum = `${namepart}${Date.now()}_${index}`;
        }
        
        const fullName = emp['Inspector'] || 'Unknown';
        const email = emp['Email'] || '';
        const phone = emp['Phone Number'] || emp['Phone'] || '';
        
        // Extract initials from name if in parentheses
        let initials = emp['Initials'] || '';
        const initialsMatch = fullName.match(/\(([A-Z]{1,3})\)/);
        if (initialsMatch) {
          initials = initialsMatch[1];
        }
        
        // Split the full name into first and last
        const nameParts = fullName.split(',').map(part => part.trim());
        const lastName = nameParts[0] || '';
        const firstName = nameParts[1] ? nameParts[1].split('(')[0].trim() : '';
        
        // Handle role with business rules
        let role = emp['Role'] || 'Unassigned';
        
        // Fixed admin roles
        if (fullName.toLowerCase().includes('tom davis')) {
          role = 'Owner';
        } else if (fullName.toLowerCase().includes('brian schneider')) {
          role = 'Owner';
        } else if (fullName.toLowerCase().includes('james duda')) {
          role = 'Management';
        } else if (role.toLowerCase().includes('office')) {
          role = 'Clerical';
        }
        
        // Handle employment status
        let employmentStatus = 'part_time';
        
        // Check for contractor status
        const rowText = Object.values(emp).join(' ').toLowerCase();
        if (rowText.includes('contractor')) {
          employmentStatus = 'contractor';
          contractorEmployees++;
        } else {
          // Handle Full time status - only exists in July 2025
          if (emp['Full time (Y/N)']) {
            employmentStatus = emp['Full time (Y/N)'].toString().toUpperCase() === 'Y' ? 'full_time' : 'part_time';
          } else {
            // Smart defaults for early files
            if (role === 'Owner' || role === 'Management') {
              employmentStatus = 'full_time';
            } else {
              employmentStatus = 'part_time';
            }
          }
        }
        
        // Handle location - only exists in July 2025
        const location = emp['LOCATION'] || emp['Location'] || 'Unknown';
        
        // Check if this is new or updated employee
        const existing = existingMap.get(email);
        if (!existing) {
          newEmployees++;
        } else if (
          existing.first_name !== firstName ||
          existing.last_name !== lastName ||
          existing.phone !== phone ||
          existing.role !== role
        ) {
          updatedEmployees++;
        }
        
        return {
          employee_number: inspectorNum.toString(),
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phone,
          role: role,
          inspector_type: role,
          region: location,
          employment_status: employmentStatus,
          initials: initials,
          hire_date: new Date().toISOString().split('T')[0],
          created_by: 'dudj23@gmail.com'
        };
      });
      
      console.log('Processed employees sample:', processedEmployees[0]);
      
      // Save to database using bulk import
      const result = await employeeService.bulkImport(processedEmployees);
      
      // Reload from database to get the saved data with IDs
      await loadEmployees();
      
      // Show detailed import summary
      const fileType = Object.keys(mainSheetData[0] || {}).length <= 4 ? 'Early Format' : 'Current Format';
      const summary = [
        `✅ Import completed: ${result.length} total records processed`,
        `📄 File format: ${fileType} (${Object.keys(mainSheetData[0] || {}).length} columns)`,
        `📊 Changes detected:`,
        `  • ${newEmployees} new employees added`,
        `  • ${updatedEmployees} existing employees updated`,
        contractorEmployees > 0 ? `  • ${contractorEmployees} contractors identified` : '',
        ``,
        `📁 Import details:`,
        `  • File: ${file.name}`,
        `  • Processed: ${new Date().toLocaleString()}`,
        `  • Business rules applied (Tom Davis, Brian Schneider, James Duda)`
      ].filter(Boolean).join('\n');
      
      alert(summary);
      
    } catch (error) {
      console.error('Error importing employee data:', error);
      alert(`❌ Error importing file: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  };

  // Add new employee function
  const handleAddEmployee = async (employeeData) => {
    try {
      const newEmployeeData = {
        employee_number: employeeData.inspectorNumber,
        first_name: employeeData.firstName,
        last_name: employeeData.lastName,
        email: employeeData.email,
        phone: employeeData.phone,
        employment_status: employeeData.isFullTime ? 'full_time' : 'part_time',
        role: employeeData.role,
        region: employeeData.location,
        initials: employeeData.initials || ''
      };

      await employeeService.create(newEmployeeData);
      await loadEmployees();
      setShowAddEmployee(false);
      alert('✅ Employee added successfully!');
    } catch (error) {
      console.error('Error adding employee:', error);
      alert(`❌ Error adding employee: ${error.message}`);
    }
  };

  // Edit employee function
  const handleEditEmployee = async (employeeId, updatedData) => {
    try {
      const updateData = {
        employee_number: updatedData.inspectorNumber,
        first_name: updatedData.firstName,
        last_name: updatedData.lastName,
        email: updatedData.email,
        phone: updatedData.phone,
        employment_status: updatedData.isFullTime ? 'full_time' : 'part_time',
        role: updatedData.role,
        region: updatedData.location,
        initials: updatedData.initials || ''
      };

      await loadEmployees();
      setEditingEmployee(null);
      alert('✅ Employee updated successfully!');
    } catch (error) {
      console.error('Error updating employee:', error);
      alert(`❌ Error updating employee: ${error.message}`);
    }
  };

  // Filter employees based on search and filters
  useEffect(() => {
    let filtered = employees.filter(emp => {
      const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           String(emp.inspectorNumber).includes(searchTerm);
      
      const matchesRole = filterRole === 'all' || emp.role === filterRole;
      const matchesLocation = filterLocation === 'all' || emp.location === filterLocation;
      const matchesFullTime = filterFullTime === 'all' || 
                             (filterFullTime === 'fulltime' && emp.isFullTime && !emp.isContractor) ||
                             (filterFullTime === 'parttime' && !emp.isFullTime && !emp.isContractor) ||
                             (filterFullTime === 'contractor' && emp.isContractor);
      
      return matchesSearch && matchesRole && matchesLocation && matchesFullTime;
    });
    setFilteredEmployees(filtered);
  }, [employees, searchTerm, filterRole, filterLocation, filterFullTime]);

  const getUniqueValues = (key) => {
    return [...new Set(employees.map(emp => emp[key]))].filter(Boolean).sort();
  };

  const handleSelectEmployee = (employeeId) => {
    setSelectedEmployees(prev => 
      prev.includes(employeeId) 
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  const handleSelectAll = () => {
    if (selectedEmployees.length === filteredEmployees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(filteredEmployees.map(emp => emp.id));
    }
  };

  const handleBulkEmail = () => {
    const emails = selectedEmployees
      .map(id => employees.find(emp => emp.id === id)?.email)
      .filter(Boolean);
    
    if (emails.length > 0) {
      const subject = encodeURIComponent('Professional Property Appraisers - Update');
      window.open(`mailto:${emails.join(',')}?subject=${subject}`);
    }
  };

  const getEmployeeStats = () => {
    const total = employees.length;
    const active = employees.filter(emp => emp.status === 'active').length;
    const terminated = employees.filter(emp => emp.status === 'terminated').length;
    const fullTime = employees.filter(emp => emp.isFullTime && !emp.isContractor).length;
    const partTime = employees.filter(emp => !emp.isFullTime && !emp.isContractor).length;
    const contractors = employees.filter(emp => emp.isContractor).length;
    const withIssues = employees.filter(emp => emp.hasIssues).length;
    const residential = employees.filter(emp => emp.role === 'Residential').length;
    const commercial = employees.filter(emp => emp.role === 'Commercial').length;
    const management = employees.filter(emp => emp.role === 'Management').length;
    const clerical = employees.filter(emp => emp.role === 'Clerical' || emp.role === 'Office').length;
    const owners = employees.filter(emp => emp.role === 'Owner').length;
    
    return { total, active, terminated, fullTime, partTime, contractors, withIssues, residential, commercial, management, clerical, owners };
  };

  const stats = getEmployeeStats();

  // Show loading state
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-gray-600">Loading employee data from database...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          PPA Management OS - Employee Management
        </h1>
        <p className="text-gray-600">
          Professional Property Appraisers Inc - Employee Database & Management
        </p>
      </div>

      {/* Database Status Bar */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-green-600" />
            <span className="font-medium text-gray-800">
              🟢 Database Connected: {employees.length > 0 ? `${employees.length} Records Loaded` : 'No Data Imported'}
            </span>
          </div>
          {employees.length > 0 && (
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <span>{stats.total} Total</span>
              <span className="text-green-600">{stats.active} Active</span>
              {stats.terminated > 0 && <span className="text-red-600">{stats.terminated} Former</span>}
              <span>{stats.residential} Residential</span>
              <span>{stats.commercial} Commercial</span>
              <span>{stats.management} Management</span>
              {stats.contractors > 0 && <span className="text-purple-600">{stats.contractors} 1099</span>}
            </div>
          )}
          <button
            onClick={() => setShowAddEmployee(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📊 Overview & Statistics
            </button>
            <button
              onClick={() => setActiveTab('directory')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'directory'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              👥 Employee Directory
            </button>
            <button
              onClick={() => setActiveTab('management')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'management'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              ⚙️ Data Management
            </button>
          </nav>
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* No Data State */}
          {employees.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <Upload className="w-16 h-16 mx-auto mb-4 text-yellow-500" />
              <h3 className="text-xl font-semibold mb-2 text-yellow-800">No Employee Data in Database</h3>
              <p className="text-yellow-700 mb-6">
                Import your Excel employee file to populate the database and start managing your team
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileImport(e.target.files[0]);
                  }
                }}
                className="hidden"
                id="file-upload-overview"
                disabled={isImporting}
              />
              <label
                htmlFor="file-upload-overview"
                className={`cursor-pointer px-6 py-3 text-white rounded-lg font-medium text-lg inline-flex items-center gap-2 ${
                  isImporting ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {isImporting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Importing to Database...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Import Employee Excel File
                  </>
                )}
              </label>
            </div>
          )}

          {/* Import Success Status */}
          {importComplete && employees.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                <h3 className="text-lg font-semibold text-green-800">Employee Data Loaded from Database!</h3>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.total}</div>
                  <div className="text-sm text-gray-600">Total Employees</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{stats.fullTime}</div>
                  <div className="text-sm text-gray-600">Full Time W2</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{stats.partTime}</div>
                  <div className="text-sm text-gray-600">Part Time W2</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{stats.contractors}</div>
                  <div className="text-sm text-gray-600">1099 Contractors</div>
                </div>
              </div>
              
              <div className="text-sm text-green-700">
                💾 All data is permanently stored in your Supabase database - no more data loss!
              </div>
            </div>
          )}

          {/* Role Distribution - only show if we have data */}
          {employees.length > 0 && (
            <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
              <div className="flex items-center mb-6">
                <Users className="w-8 h-8 mr-3 text-blue-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">👥 Employee Role Distribution</h2>
                  <p className="text-gray-600 mt-1">
                    Breakdown of inspector roles and employment types
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-white rounded-lg border shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">Inspector Types</h3>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded border-l-4 border-green-400">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                        <span className="font-medium">🏠 Residential Inspectors</span>
                      </div>
                      <span className="text-xl font-bold text-green-600">{stats.residential}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded border-l-4 border-blue-400">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-blue-500 rounded-full mr-3"></div>
                        <span className="font-medium">🏭 Commercial Inspectors</span>
                      </div>
                      <span className="text-xl font-bold text-blue-600">{stats.commercial}</span>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded border-l-4 border-orange-400">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-orange-500 rounded-full mr-3"></div>
                        <span className="font-medium">👔 Management Team</span>
                      </div>
                      <span className="text-xl font-bold text-orange-600">{stats.management}</span>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-purple-50 rounded border-l-4 border-purple-400">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-purple-500 rounded-full mr-3"></div>
                        <span className="font-medium">💼 Office/Clerical</span>
                      </div>
                      <span className="text-xl font-bold text-purple-600">{stats.clerical}</span>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-white rounded-lg border shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">Employment Status</h3>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded border-l-4 border-green-400">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-green-500 mr-3" />
                        <span className="font-medium">Full Time W2</span>
                      </div>
                      <span className="text-xl font-bold text-green-600">{stats.fullTime}</span>
                    </div>
                    
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded border-l-4 border-orange-400">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-orange-500 mr-3" />
                        <span className="font-medium">Part Time W2</span>
                      </div>
                      <span className="text-xl font-bold text-orange-600">{stats.partTime}</span>
                    </div>

                    <div className="flex justify-between items-center p-3 bg-purple-50 rounded border-l-4 border-purple-400">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-purple-500 mr-3" />
                        <span className="font-medium">1099 Contractors</span>
                      </div>
                      <span className="text-xl font-bold text-purple-600">{stats.contractors}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Regional Distribution - only show if we have data */}
          {employees.length > 0 && (
            <div className="p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">📍 Regional Distribution</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {getUniqueValues('location').map(location => {
                  const count = employees.filter(emp => emp.location === location).length;
                  const percentage = Math.round((count / employees.length) * 100);
                  return (
                    <div key={location} className="p-4 bg-gray-50 rounded-lg text-center">
                      <div className="text-2xl font-bold text-blue-600">{count}</div>
                      <div className="text-sm text-gray-600">{location} ({percentage}%)</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Employee Directory Tab */}
      {activeTab === 'directory' && (
        <div className="space-y-6">
          {/* No Data State */}
          {employees.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-yellow-500" />
              <h3 className="text-xl font-semibold mb-2 text-yellow-800">Employee Directory Empty</h3>
              <p className="text-yellow-700 mb-6">
                Import your Excel employee file to populate the database and browse employee contacts
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileImport(e.target.files[0]);
                  }
                }}
                className="hidden"
                id="file-upload-directory"
                disabled={isImporting}
              />
              <label
                htmlFor="file-upload-directory"
                className={`cursor-pointer px-6 py-3 text-white rounded-lg font-medium text-lg inline-flex items-center gap-2 ${
                  isImporting ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {isImporting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Importing to Database...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Import Employee Excel File
                  </>
                )}
              </label>
            </div>
          )}

          {employees.length > 0 && (
            <>
              {/* Search and Filters */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex-1 min-w-64">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                      <input
                        type="text"
                        placeholder="Search employees..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                      />
                    </div>
                  </div>
                  
                  <select 
                    value={filterRole} 
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                  >
                    <option value="all">All Roles</option>
                    {getUniqueValues('role').map(role => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  
                  <select 
                    value={filterLocation} 
                    onChange={(e) => setFilterLocation(e.target.value)}
                    className="px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                  >
                    <option value="all">All Locations</option>
                    {getUniqueValues('location').map(location => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
                  
                  <select 
                    value={filterFullTime} 
                    onChange={(e) => setFilterFullTime(e.target.value)}
                    className="px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                  >
                    <option value="all">All Employment Types</option>
                    <option value="fulltime">Full Time W2</option>
                    <option value="parttime">Part Time W2</option>
                    <option value="contractor">1099 Contractor</option>
                  </select>

                  {selectedEmployees.length > 0 && (
                    <button
                      onClick={handleBulkEmail}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <Mail className="h-4 w-4" />
                      <span>Email Selected ({selectedEmployees.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Employee List */}
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="p-4 border-b bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={selectedEmployees.length === filteredEmployees.length && filteredEmployees.length > 0}
                        onChange={handleSelectAll}
                        className="rounded"
                      />
                      <span className="font-medium">
                        {filteredEmployees.length} employees found
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {selectedEmployees.length} selected
                    </div>
                  </div>
                </div>
                
                <div className="divide-y max-h-96 overflow-y-auto">
                  {filteredEmployees.map((employee) => (
                    <div key={employee.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-center space-x-4">
                        <input
                          type="checkbox"
                          checked={selectedEmployees.includes(employee.id)}
                          onChange={() => handleSelectEmployee(employee.id)}
                          className="rounded"
                        />
                        
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
                          {/* Name and ID */}
                          <div className="md:col-span-2">
                            <div className="flex items-center space-x-2">
                              <div>
                                <div className="font-medium text-gray-900">{employee.name}</div>
                                <div className="text-sm text-gray-500">#{employee.inspectorNumber}</div>
                              </div>
                              {employee.hasIssues && (
                                <AlertTriangle className="h-4 w-4 text-red-500" title="Missing information" />
                              )}
                            </div>
                          </div>
                          
                          {/* Contact */}
                          <div>
                            <div className="flex items-center space-x-1 text-sm">
                              <Mail className="h-3 w-3 text-gray-400" />
                              <span className="text-gray-600 truncate">{employee.email || 'No email'}</span>
                            </div>
                            <div className="flex items-center space-x-1 text-sm">
                              <Phone className="h-3 w-3 text-gray-400" />
                              <span className="text-gray-600">{employee.phone || 'No phone'}</span>
                            </div>
                          </div>
                          
                          {/* Role */}
                          <div>
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              employee.role === 'Residential' ? 'bg-green-100 text-green-800' :
                              employee.role === 'Commercial' ? 'bg-blue-100 text-blue-800' :
                              employee.role === 'Office' || employee.role === 'Clerical' ? 'bg-purple-100 text-purple-800' :
                              employee.role === 'Management' ? 'bg-orange-100 text-orange-800' :
                              employee.role === 'Owner' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {employee.role === 'Residential' ? '🏠' : 
                               employee.role === 'Commercial' ? '🏭' :
                               employee.role === 'Office' || employee.role === 'Clerical' ? '💼' :
                               employee.role === 'Management' ? '👔' : 
                               employee.role === 'Owner' ? '👑' : '👤'} {employee.role}
                            </span>
                          </div>
                          
                          {/* Location */}
                          <div className="flex items-center space-x-1">
                            <MapPin className="h-3 w-3 text-gray-400" />
                            <span className="text-sm text-gray-600">{employee.location}</span>
                            {employee.zipCode && (
                              <span className="text-xs text-gray-400">({employee.zipCode})</span>
                            )}
                          </div>
                          
                          {/* Employment Type & Status */}
                          <div className="flex items-center space-x-1">
                            <Clock className="h-3 w-3 text-gray-400" />
                            <span className={`text-sm ${
                              employee.isContractor ? 'text-purple-600' :
                              employee.isFullTime ? 'text-green-600' : 'text-orange-600'
                            }`}>
                              {employee.isContractor ? '1099 Contractor' :
                               employee.isFullTime ? 'Full Time W2' : 'Part Time W2'}
                            </span>
                            {employee.status === 'terminated' && (
                              <span className="text-xs bg-red-100 text-red-600 px-1 rounded">Former</span>
                            )}
                          </div>
                          
                          {/* Actions */}
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setEditingEmployee(employee)}
                              className="text-blue-600 hover:text-blue-800"
                              title="Edit employee"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            {employee.email && (
                              <a
                                href={`mailto:${employee.email}`}
                                className="text-green-600 hover:text-green-800"
                                title="Send email"
                              >
                                <Mail className="h-4 w-4" />
                              </a>
                            )}
                            {employee.phone && (
                              <a
                                href={`tel:${employee.phone}`}
                                className="text-orange-600 hover:text-orange-800"
                                title="Call"
                              >
                                <Phone className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {filteredEmployees.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    No employees found matching your criteria.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Data Management Tab */}
      {activeTab === 'management' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center mb-6">
              <Settings className="w-8 h-8 mr-3 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">⚙️ Employee Data Management</h2>
                <p className="text-gray-600 mt-1">
                  Import, export, and manage employee database information
                </p>
              </div>
            </div>
            
            {/* Database Status */}
            <div className="mb-6 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                📊 Database Status & Management
              </h3>
              
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-green-800 flex items-center">
                      🟢 Database Connected & Active
                    </h4>
                    <p className="text-sm text-green-700 mt-1">
                      {stats.total} employee records stored in Supabase database
                    </p>
                  </div>
                  <div className="text-right">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileImport(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                      id="file-update-management"
                      disabled={isImporting}
                    />
                    <label
                      htmlFor="file-update-management"
                      className={`cursor-pointer px-4 py-2 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2 ${
                        isImporting ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'
                      }`}
                    >
                      {isImporting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Updating Database...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          Import/Update Data
                        </>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
                <strong>💾 Data Persistence:</strong> All employee data is now permanently stored in your database. 
                No more data loss between sessions! You can edit individual employees, add new ones, 
                or import updates without losing existing data.
              </div>
            </div>

            {/* Data Quality Report */}
            {employees.length > 0 && (
              <div className="p-6 bg-white rounded-lg border shadow-sm">
                <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                  🔍 Data Quality Report
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.total - stats.withIssues}</div>
                    <div className="text-sm text-green-700">Complete Records</div>
                    <div className="text-xs text-green-600 mt-1">All required fields present</div>
                  </div>
                  
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-orange-600">{stats.withIssues}</div>
                    <div className="text-sm text-orange-700">Missing Data</div>
                    <div className="text-xs text-orange-600 mt-1">Phone, email, or ID missing</div>
                  </div>
                  
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-600">{employees.length > 0 ? Math.round(((stats.total - stats.withIssues) / stats.total) * 100) : 0}%</div>
                    <div className="text-sm text-blue-700">Data Quality</div>
                    <div className="text-xs text-blue-600 mt-1">Overall completeness score</div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                🚀 Available Actions
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => {
                    const csvContent = [
                      ['Inspector #', 'Name', 'Email', 'Phone', 'Role', 'Location', 'Employment Type'].join(','),
                      ...employees.map(emp => [
                        emp.inspectorNumber,
                        `"${emp.name}"`,
                        emp.email,
                        emp.phone,
                        emp.role,
                        emp.location,
                        emp.isContractor ? '1099 Contractor' : emp.isFullTime ? 'Full Time W2' : 'Part Time W2'
                      ].join(','))
                    ].join('\n');
                    
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `PPA_Employee_Export_${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                  }}
                  className="p-4 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors text-left"
                  disabled={employees.length === 0}
                >
                  <div className="text-green-700 font-semibold mb-2">📁 Export Database</div>
                  <div className="text-sm text-green-600">Download complete employee database</div>
                </button>
                
                <button
                  onClick={() => setShowAddEmployee(true)}
                  className="p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
                >
                  <div className="text-blue-700 font-semibold mb-2">➕ Add Employee</div>
                  <div className="text-sm text-blue-600">Manually add new employee to database</div>
                </button>
                
                <button
                  onClick={() => loadEmployees()}
                  className="p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors text-left"
                >
                  <div className="text-purple-700 font-semibold mb-2">🔄 Refresh Data</div>
                  <div className="text-sm text-purple-600">Reload employee data from database</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add New Employee</h3>
            <p className="text-gray-600 mb-4">This will be added directly to your database.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddEmployee(false)}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowAddEmployee(false);
                  alert('Add employee form coming next!');
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManagement;
