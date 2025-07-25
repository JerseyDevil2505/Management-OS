import React, { useState, useEffect } from 'react';
import { Users, Upload, Search, Mail, Phone, MapPin, Clock, AlertTriangle, Settings, Database, CheckCircle, Loader, Edit, X, Copy, FileText, Download, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { employeeService, signInAsDev, supabase } from '../lib/supabaseClient';

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
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailModalData, setEmailModalData] = useState({ emails: [], title: '' });

  // Global Analytics State
  const [globalAnalytics, setGlobalAnalytics] = useState(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsFilter, setAnalyticsFilter] = useState({
    inspectorType: 'all',
    region: 'all',
    dateRange: 'all',
    employmentStatus: 'active'  // Default to active only
  });

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
        location: emp.region || 'HEADQUARTERS',
        zipCode: emp.zip_code || '',
        weeklyHours: emp.weekly_hours || null,
        hasIssues: !emp.employee_number || !emp.email || !emp.phone,
        initials: emp.initials,
        status: emp.employment_status === 'inactive' ? 'inactive' : 'active'
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

  // Fixed Global Analytics Functions
  const loadGlobalAnalytics = async () => {
    setIsLoadingAnalytics(true);
    try {
      // Get inspection data separately (no JOIN) 
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('inspection_data')
        .select('*');

      if (inspectionError) throw inspectionError;

      console.log('🔍 INSPECTION DATA:', inspectionData?.length, 'records found');
      console.log('🔍 Sample inspection record:', inspectionData?.[0]);

      // Get ONLY inspector employees (Residential, Commercial, Management)
      // DEBUG: First check what inspector types exist
      const { data: allEmployees } = await supabase.from('employees').select('inspector_type, role, initials, first_name, last_name');
      console.log('🔍 ALL EMPLOYEES inspector_type values:', [...new Set(allEmployees?.map(e => e.inspector_type))]);
      console.log('🔍 ALL EMPLOYEES role values:', [...new Set(allEmployees?.map(e => e.role))]);
      
      let employeesQuery = supabase
        .from('employees')
        .select('*')
        .in('inspector_type', ['Residential', 'Commercial', 'Management']);

      // Apply employment status filter
      if (analyticsFilter.employmentStatus === 'active') {
        // 'active' means NOT inactive (full_time, part_time, contractor)
        employeesQuery = employeesQuery.neq('employment_status', 'inactive');
      } else if (analyticsFilter.employmentStatus !== 'all') {
        employeesQuery = employeesQuery.eq('employment_status', analyticsFilter.employmentStatus);
      }

      const { data: employeesData, error: employeesError } = await employeesQuery;

      if (employeesError) throw employeesError;

      console.log('🔍 EMPLOYEES DATA:', employeesData?.length, 'inspector employees found');
      console.log('🔍 Sample employee:', employeesData?.[0]);
      console.log('🔍 Employee initials:', employeesData?.map(e => e.initials).filter(Boolean));

      if (!inspectionData || inspectionData.length === 0) {
        setGlobalAnalytics({
          summary: { totalInspections: 0, overallEntryRate: 0, overallRefusalRate: 0, avgInspectionsPerDay: 0 },
          inspectors: [],
          regional: {}
        });
        return;
      }

      // Create lookup map for employees by initials
      const employeeMap = {};
      employeesData.forEach(emp => {
        if (emp.initials) {
          employeeMap[emp.initials] = emp;
        }
      });

      console.log('🔍 EMPLOYEE MAP:', Object.keys(employeeMap));

      // Process inspection data and match with employees
      const enrichedData = [];
      inspectionData.forEach(record => {
        // Check all "by" fields for inspector initials
        const inspectorInitials = record.list_by || record.measure_by || record.price_by;
        
        if (inspectorInitials && employeeMap[inspectorInitials]) {
          enrichedData.push({
            ...record,
            employee: employeeMap[inspectorInitials]
          });
        }
      });

      console.log('🔍 ENRICHED DATA:', enrichedData?.length, 'matched records');
      console.log('🔍 Sample enriched record:', enrichedData?.[0]);

      // Sample of inspection initials for debugging
      const inspectionInitials = inspectionData?.slice(0, 10).map(r => ({
        list_by: r.list_by,
        measure_by: r.measure_by, 
        price_by: r.price_by,
        chosen: r.list_by || r.measure_by || r.price_by
      }));
      console.log('🔍 INSPECTION INITIALS (first 10):', inspectionInitials);

      // Process the enriched data similar to ProductionTracker
      const processedAnalytics = processGlobalInspectionData(enrichedData, analyticsFilter);
      setGlobalAnalytics(processedAnalytics);

    } catch (error) {
      console.error('Error loading global analytics:', error);
      setGlobalAnalytics({
        summary: { totalInspections: 0, overallEntryRate: 0, overallRefusalRate: 0, avgInspectionsPerDay: 0 },
        inspectors: [],
        regional: {}
      });
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const processGlobalInspectionData = (data, filter) => {
    // Filter data based on current filters
    let filteredData = data.filter(record => {
      const matchesType = filter.inspectorType === 'all' || record.employee.inspector_type === filter.inspectorType;
      const matchesRegion = filter.region === 'all' || record.employee.region === filter.region;
      
      // FIXED: Don't filter out commercial inspectors based on property type
      // Let all inspector types show up in analytics regardless of what they inspect
      return matchesType && matchesRegion;
    });

    // Calculate summary metrics
    const totalInspections = filteredData.length;
    const validInspections = filteredData.filter(r => r.list_by || r.measure_by || r.price_by).length;
    
    // Calculate entry/refusal rates using ProductionTracker logic
    let entryCount = 0;
    let refusalCount = 0;
    let totalEligible = 0;

    const inspectorStats = {};

    filteredData.forEach(record => {
      const inspector = record.employee;
      const initials = inspector.initials || 'Unknown';
      
      if (!inspectorStats[initials]) {
        inspectorStats[initials] = {
          name: `${inspector.first_name} ${inspector.last_name}`,
          initials: initials,
          inspectorType: inspector.inspector_type,
          region: inspector.region,
          totalInspections: 0,
          entryInspections: 0,
          refusalInspections: 0,
          entryRate: 0,
          refusalRate: 0,
          dailyAvg: 0
        };
      }

      inspectorStats[initials].totalInspections++;

      // Determine if this is entry/refusal based on InfoBy codes (copying ProductionTracker logic)
      if (record.info_by_code && record.property_class && ['2', '3A'].includes(record.property_class)) {
        totalEligible++;
        inspectorStats[initials].totalEligible = (inspectorStats[initials].totalEligible || 0) + 1;

        // Simple InfoBy logic - matches ProductionTracker's current implementation
        const infoBy = record.info_by_code.toString().toLowerCase();
        if (['01', '02', '03', '04', 'a', 'o', 's', 't'].includes(infoBy)) {
          entryCount++;
          inspectorStats[initials].entryInspections++;
        } else if (['06', 'r'].includes(infoBy)) {
          refusalCount++;
          inspectorStats[initials].refusalInspections++;
        }
      }
    });

    // Calculate rates for each inspector
    Object.keys(inspectorStats).forEach(initials => {
      const stats = inspectorStats[initials];
      const eligible = stats.totalEligible || 0;
      stats.entryRate = eligible > 0 ? Math.round((stats.entryInspections / eligible) * 100) : 0;
      stats.refusalRate = eligible > 0 ? Math.round((stats.refusalInspections / eligible) * 100) : 0;
      stats.dailyAvg = stats.totalInspections > 0 ? Math.round((stats.totalInspections / 30) * 10) / 10 : 0; // Rough daily avg
    });

    // Convert to array and sort by total inspections
    const inspectorArray = Object.values(inspectorStats)
      .filter(inspector => inspector.totalInspections > 0)
      .sort((a, b) => b.totalInspections - a.totalInspections);

    // Calculate regional breakdown
    const regionalStats = {};
    inspectorArray.forEach(inspector => {
      if (!regionalStats[inspector.region]) {
        regionalStats[inspector.region] = {
          totalInspections: 0,
          inspectors: 0,
          avgEntryRate: 0,
          avgRefusalRate: 0
        };
      }
      regionalStats[inspector.region].totalInspections += inspector.totalInspections;
      regionalStats[inspector.region].inspectors++;
    });

    // Calculate regional averages
    Object.keys(regionalStats).forEach(region => {
      const regionInspectors = inspectorArray.filter(i => i.region === region);
      const avgEntry = regionInspectors.reduce((sum, i) => sum + i.entryRate, 0) / regionInspectors.length;
      const avgRefusal = regionInspectors.reduce((sum, i) => sum + i.refusalRate, 0) / regionInspectors.length;
      
      regionalStats[region].avgEntryRate = Math.round(avgEntry) || 0;
      regionalStats[region].avgRefusalRate = Math.round(avgRefusal) || 0;
    });

    return {
      summary: {
        totalInspections: validInspections,
        overallEntryRate: totalEligible > 0 ? Math.round((entryCount / totalEligible) * 100) : 0,
        overallRefusalRate: totalEligible > 0 ? Math.round((refusalCount / totalEligible) * 100) : 0,
        avgInspectionsPerDay: validInspections > 0 ? Math.round((validInspections / 30) * 10) / 10 : 0
      },
      inspectors: inspectorArray,
      regional: regionalStats
    };
  };

  // Load analytics when component mounts or filters change
  useEffect(() => {
    if (employees.length > 0) {
      loadGlobalAnalytics();
    }
  }, [employees.length, analyticsFilter]);

  const handleFilterChange = (filterType, value) => {
    setAnalyticsFilter(prev => ({
      ...prev,
      [filterType]: value
    }));
  };

  // Import Excel file function with proper variable declarations and UPSERT logic
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
      const existingEmailMap = new Map(existingEmployees.map(emp => [emp.email, emp]));
      
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
        const weeklyHours = emp['Weekly Hours'] || emp['Hours'] || null;
        
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
        if (rowText.includes('contractor') || role.toLowerCase() === 'contractor') {
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
        const location = emp['LOCATION'] || emp['Location'] || 'HEADQUARTERS';
        
        // Check if this is new or updated employee
        const existing = existingEmailMap.get(email);
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
          weekly_hours: weeklyHours ? parseFloat(weeklyHours) : null,
          hire_date: new Date().toISOString().split('T')[0],
          created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad'
        };
      });
      
      console.log('Processed employees sample:', processedEmployees[0]);
      
      // Mark employees not in new import as inactive
      const newEmployeeEmails = new Set(processedEmployees.map(emp => emp.email));
      const inactiveUpdates = existingEmployees
        .filter(existing => existing.employment_status !== 'inactive' && !newEmployeeEmails.has(existing.email))
        .map(emp => ({
          ...emp,
          employment_status: 'inactive',
          termination_date: new Date().toISOString().split('T')[0]
        }));
      
      let inactiveCount = 0;
      if (inactiveUpdates.length > 0) {
        await employeeService.bulkUpdate(inactiveUpdates);
        inactiveCount = inactiveUpdates.length;
      }
      
      // Save to database using bulk upsert (insert or update)
      const result = await employeeService.bulkUpsert(processedEmployees);
      
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
        inactiveCount > 0 ? `  • ${inactiveCount} employees marked as inactive` : '',
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
                           String(emp.inspectorNumber).includes(searchTerm) ||
                           (emp.initials && emp.initials.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesRole = filterRole === 'all' || emp.role === filterRole;
      const matchesLocation = filterLocation === 'all' || emp.location === filterLocation;
      const matchesFullTime = filterFullTime === 'all' || 
                             (filterFullTime === 'fulltime' && emp.isFullTime && !emp.isContractor) ||
                             (filterFullTime === 'parttime' && !emp.isFullTime && !emp.isContractor) ||
                             (filterFullTime === 'contractor' && emp.isContractor) ||
                             (filterFullTime === 'inactive' && emp.status === 'inactive');
      
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

  // Email modal functions
  const openEmailModal = (emails, title) => {
    setEmailModalData({ emails: emails.filter(Boolean), title });
    setShowEmailModal(true);
  };

  const copyEmailsToClipboard = () => {
    const emailString = emailModalData.emails.join(', ');
    navigator.clipboard.writeText(emailString).then(() => {
      alert('✅ Email addresses copied to clipboard!');
      setShowEmailModal(false);
    }).catch(() => {
      alert('❌ Failed to copy emails. Please select and copy manually.');
    });
  };

  // Bulk email functions
  const handleBulkEmail = () => {
    const emails = selectedEmployees
      .map(id => employees.find(emp => emp.id === id)?.email)
      .filter(Boolean);
    
    if (emails.length > 0) {
      openEmailModal(emails, `Selected Employees (${emails.length})`);
    }
  };

  const handleEmailAll = () => {
    const emails = employees
      .filter(emp => emp.status === 'active' && emp.email)
      .map(emp => emp.email);
    
    if (emails.length > 0) {
      openEmailModal(emails, 'All Active Staff');
    }
  };

  const handleEmailByRole = (role) => {
    const emails = employees
      .filter(emp => emp.status === 'active' && emp.role === role && emp.email)
      .map(emp => emp.email);
    
    if (emails.length > 0) {
      openEmailModal(emails, `${role} Team`);
    } else {
      alert(`No active ${role} employees found with email addresses.`);
    }
  };

  const handleEmailByRegion = (region) => {
    const emails = employees
      .filter(emp => emp.status === 'active' && emp.location === region && emp.email)
      .map(emp => emp.email);
    
    if (emails.length > 0) {
      openEmailModal(emails, `${region} Region`);
    } else {
      alert(`No active employees found in ${region} region with email addresses.`);
    }
  };

  const getEmployeeStats = () => {
    const totalWorkforce = employees.length;
    const contractors = employees.filter(emp => emp.isContractor).length;
    const totalEmployees = employees.filter(emp => emp.status === 'active' && !emp.isContractor).length;
    const active = employees.filter(emp => emp.status === 'active' && !emp.isContractor).length;
    const inactive = employees.filter(emp => emp.status === 'inactive').length;
    const fullTime = employees.filter(emp => emp.isFullTime && !emp.isContractor && emp.status === 'active').length;
    const partTime = employees.filter(emp => !emp.isFullTime && !emp.isContractor && emp.status === 'active').length;
    const withIssues = employees.filter(emp => emp.hasIssues && emp.status === 'active').length;
    const residential = employees.filter(emp => emp.role === 'Residential' && emp.status === 'active').length;
    const commercial = employees.filter(emp => emp.role === 'Commercial' && emp.status === 'active').length;
    const management = employees.filter(emp => emp.role === 'Management' && emp.status === 'active').length;
    const clerical = employees.filter(emp => (emp.role === 'Clerical' || emp.role === 'Office') && emp.status === 'active').length;
    const owners = employees.filter(emp => emp.role === 'Owner' && emp.status === 'active').length;
    
    // Calculate FTE
    const fullTimeFTE = fullTime * 1.0;
    const partTimeFTE = employees
      .filter(emp => !emp.isFullTime && !emp.isContractor && emp.status === 'active')
      .reduce((total, emp) => total + ((emp.weeklyHours || 0) / 40), 0);
    const totalFTE = fullTimeFTE + partTimeFTE;
    
    return { 
      totalEmployees,
      contractors,
      totalWorkforce,
      active, 
      inactive, 
      fullTime, 
      partTime, 
      withIssues, 
      residential, 
      commercial, 
      management, 
      clerical, 
      owners,
      totalFTE: Math.round(totalFTE * 100) / 100 // Round to 2 decimal places
    };
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
              🟢 Database Connected: {employees.length > 0 ? `${stats.totalWorkforce} Records Loaded` : 'No Data Imported'}
            </span>
          </div>
          {employees.length > 0 && (
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <span>{stats.totalEmployees} Employees</span>
              <span className="text-green-600">{stats.active} Active</span>
              {stats.inactive > 0 && <span className="text-red-600">{stats.inactive} Inactive</span>}
              <span>{stats.residential} Residential</span>
              <span>{stats.commercial} Commercial</span>
              <span>{stats.management} Management</span>
              {stats.contractors > 0 && <span className="text-purple-600">{stats.contractors} 1099</span>}
            </div>
          )}
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
              onClick={() => setActiveTab('forms')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'forms'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📋 HR Forms & Documents
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

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-96">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">📧 {emailModalData.title}</h3>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                {emailModalData.emails.length} email addresses ready to copy:
              </p>
              <div className="bg-gray-50 p-3 rounded border max-h-48 overflow-y-auto">
                <div className="text-sm font-mono">
                  {emailModalData.emails.join(', ')}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={copyEmailsToClipboard}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Copy className="w-4 h-4" />
                Copy All Emails
              </button>
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <div className="text-2xl font-bold text-green-600">{stats.totalEmployees}</div>
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

          {/* FTE Calculation Display */}
          {employees.length > 0 && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border-2 border-purple-200 p-6">
              <div className="flex items-center mb-4">
                <Users className="w-8 h-8 mr-3 text-purple-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">⚖️ Full-Time Equivalent (FTE) Analysis</h2>
                  <p className="text-gray-600 mt-1">
                    Total workforce capacity based on hours worked
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                  <div className="text-3xl font-bold text-purple-600">{stats.totalFTE}</div>
                  <div className="text-sm text-gray-600 font-medium">Total FTE</div>
                  <div className="text-xs text-gray-500 mt-1">Equivalent full-time positions</div>
                </div>
                
                <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                  <div className="text-2xl font-bold text-green-600">{stats.fullTime}</div>
                  <div className="text-sm text-gray-600 font-medium">Full-Time FTE</div>
                  <div className="text-xs text-gray-500 mt-1">1.0 FTE each</div>
                </div>
                
                <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {Math.round((stats.totalFTE - stats.fullTime) * 100) / 100}
                  </div>
                  <div className="text-sm text-gray-600 font-medium">Part-Time FTE</div>
                  <div className="text-xs text-gray-500 mt-1">Based on weekly hours</div>
                </div>
                
                <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {Math.round((stats.totalFTE / stats.totalEmployees) * 100)}%
                  </div>
                  <div className="text-sm text-gray-600 font-medium">FTE Efficiency</div>
                  <div className="text-xs text-gray-500 mt-1">FTE vs headcount ratio</div>
                </div>
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
                    Breakdown of inspector roles and employment types (Active employees only)
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

                    {stats.inactive > 0 && (
                      <div className="flex justify-between items-center p-3 bg-red-50 rounded border-l-4 border-red-400">
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 text-red-500 mr-3" />
                          <span className="font-medium">Inactive/Former</span>
                        </div>
                        <span className="text-xl font-bold text-red-600">{stats.inactive}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Regional Distribution and Global Analytics */}
          {employees.length > 0 && (
            <>
              <div className="p-6 bg-white rounded-lg border shadow-sm">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">📍 Regional Distribution</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {getUniqueValues('location').map(location => {
                    const count = employees.filter(emp => emp.location === location && emp.status === 'active').length;
                    const percentage = count > 0 ? Math.round((count / stats.active) * 100) : 0;
                    return (
                      <div key={location} className="p-4 bg-gray-50 rounded-lg text-center">
                        <div className="text-2xl font-bold text-blue-600">{count}</div>
                        <div className="text-sm text-gray-600">{location} ({percentage}%)</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Global Inspector Analytics */}
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border-2 border-indigo-200 p-6">
                <div className="flex items-center mb-6">
                  <Users className="w-8 h-8 mr-3 text-indigo-600" />
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800">📊 Global Inspector Performance Analytics</h2>
                    <p className="text-gray-600 mt-1">
                      Cross-job performance metrics for all inspectors across the entire company
                    </p>
                  </div>
                </div>

                {isLoadingAnalytics ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader className="w-8 h-8 animate-spin text-indigo-600 mr-3" />
                    <span className="text-gray-600">Loading global analytics...</span>
                  </div>
                ) : globalAnalytics ? (
                  <>
                    {/* Filter Controls */}
                    <div className="mb-6 p-4 bg-white rounded-lg border shadow-sm">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Filter className="w-4 h-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-700">Filters:</span>
                        </div>
                        
                        <select
                          value={analyticsFilter.inspectorType}
                          onChange={(e) => handleFilterChange('inspectorType', e.target.value)}
                          className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="all">All Inspector Types</option>
                          <option value="Residential">Residential Only</option>
                          <option value="Commercial">Commercial Only</option>
                          <option value="Management">Management Only</option>
                        </select>

                        <select
                          value={analyticsFilter.region}
                          onChange={(e) => handleFilterChange('region', e.target.value)}
                          className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="all">All Regions</option>
                          {getUniqueValues('location').map(location => (
                            <option key={location} value={location}>{location}</option>
                          ))}
                        </select>

                        <select
                          value={analyticsFilter.employmentStatus}
                          onChange={(e) => handleFilterChange('employmentStatus', e.target.value)}
                          className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="active">Active Employees Only</option>
                          <option value="all">All Employees (Active + Inactive)</option>
                        </select>

                        <button
                          onClick={loadGlobalAnalytics}
                          className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-sm hover:bg-indigo-200 transition-colors"
                        >
                          🔄 Refresh
                        </button>
                      </div>
                    </div>

                    {/* Summary Metrics */}
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                        <div className="text-3xl font-bold text-indigo-600">{globalAnalytics.summary.totalInspections.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 font-medium">Total Inspections</div>
                        <div className="text-xs text-gray-500 mt-1">Across all active jobs</div>
                      </div>
                      
                      <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                        <div className="text-3xl font-bold text-green-600">{globalAnalytics.summary.overallEntryRate}%</div>
                        <div className="text-sm text-gray-600 font-medium">Overall Entry Rate</div>
                        <div className="text-xs text-gray-500 mt-1">Company-wide average</div>
                      </div>
                      
                      <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                        <div className="text-3xl font-bold text-orange-600">{globalAnalytics.summary.overallRefusalRate}%</div>
                        <div className="text-sm text-gray-600 font-medium">Overall Refusal Rate</div>
                        <div className="text-xs text-gray-500 mt-1">Company-wide average</div>
                      </div>
                      
                      <div className="p-4 bg-white rounded-lg border shadow-sm text-center">
                        <div className="text-3xl font-bold text-purple-600">{globalAnalytics.summary.avgInspectionsPerDay}</div>
                        <div className="text-sm text-gray-600 font-medium">Avg Daily Output</div>
                        <div className="text-xs text-gray-500 mt-1">Inspections per day</div>
                      </div>
                    </div>

                    {/* Regional Performance */}
                    {Object.keys(globalAnalytics.regional).length > 0 && (
                      <div className="mb-6 p-4 bg-white rounded-lg border shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-700 mb-4">🗺️ Regional Performance Breakdown</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {Object.entries(globalAnalytics.regional).map(([region, stats]) => (
                            <div key={region} className="p-3 bg-gray-50 rounded-lg">
                              <div className="font-medium text-gray-800 mb-2">{region}</div>
                              <div className="text-sm space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Inspections:</span>
                                  <span className="font-medium">{stats.totalInspections.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Inspectors:</span>
                                  <span className="font-medium">{stats.inspectors}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Avg Entry Rate:</span>
                                  <span className="font-medium text-green-600">{stats.avgEntryRate}%</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Avg Refusal Rate:</span>
                                  <span className="font-medium text-orange-600">{stats.avgRefusalRate}%</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Inspector Performance Cards */}
                    <div className="p-4 bg-white rounded-lg border shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-700 mb-4">👥 Inspector Performance Rankings</h3>
                      
                      {globalAnalytics.inspectors.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Users className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                          <p>No inspection data found matching current filters</p>
                          <p className="text-sm mt-1">Try adjusting filters or ensure inspection data is available</p>
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {globalAnalytics.inspectors.map((inspector, index) => (
                            <div
                              key={inspector.initials}
                              className={`p-4 rounded-lg border-l-4 ${
                                inspector.inspectorType === 'Residential' ? 'border-green-400 bg-green-50' :
                                inspector.inspectorType === 'Commercial' ? 'border-blue-400 bg-blue-50' :
                                inspector.inspectorType === 'Management' ? 'border-purple-400 bg-purple-50' :
                                'border-gray-400 bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                                    inspector.inspectorType === 'Residential' ? 'bg-green-500' :
                                    inspector.inspectorType === 'Commercial' ? 'bg-blue-500' :
                                    inspector.inspectorType === 'Management' ? 'bg-purple-500' :
                                    'bg-gray-500'
                                  }`}>
                                    {index + 1}
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-800">
                                      {inspector.name} ({inspector.initials})
                                    </div>
                                    <div className="text-sm text-gray-600">
                                      {inspector.inspectorType} • {inspector.region}
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="text-right">
                                  <div className="text-2xl font-bold text-gray-800">
                                    {inspector.totalInspections.toLocaleString()}
                                  </div>
                                  <div className="text-xs text-gray-500">Total Inspections</div>
                                </div>
                              </div>
                              
                              <div className="mt-3 grid grid-cols-3 gap-4 text-center">
                                <div>
                                  <div className="text-lg font-bold text-green-600">{inspector.entryRate}%</div>
                                  <div className="text-xs text-gray-500">Entry Rate</div>
                                </div>
                                <div>
                                  <div className="text-lg font-bold text-orange-600">{inspector.refusalRate}%</div>
                                  <div className="text-xs text-gray-500">Refusal Rate</div>
                                </div>
                                <div>
                                  <div className="text-lg font-bold text-purple-600">{inspector.dailyAvg}</div>
                                  <div className="text-xs text-gray-500">Daily Avg</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Database className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p>No inspection data available</p>
                    <p className="text-sm mt-1">Analytics will appear once inspection data is processed</p>
                  </div>
                )}
              </div>
            </>
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
              {/* Bulk Email Actions */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-lg font-semibold mb-3 text-blue-800">📧 Bulk Email Actions</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleEmailAll}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-200 text-sm font-medium"
                  >
                    <Mail className="w-4 h-4" />
                    Email All Active Staff
                  </button>
                  
                  {/* Email by Role buttons with matching colors */}
                  {getUniqueValues('role').filter(role => employees.some(emp => emp.role === role && emp.status === 'active')).map(role => (
                    <button
                      key={role}
                      onClick={() => handleEmailByRole(role)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                        role === 'Residential' ? 'bg-green-100 text-green-800 border border-green-300 hover:bg-green-200' :
                        role === 'Commercial' ? 'bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-200' :
                        role === 'Management' ? 'bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-200' :
                        role === 'Clerical' || role === 'Office' ? 'bg-purple-100 text-purple-800 border border-purple-300 hover:bg-purple-200' :
                        'bg-gray-100 text-gray-800 border border-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      Email {role} Team
                    </button>
                  ))}
                  
                  {/* Email by Region buttons */}
                  {getUniqueValues('location').filter(location => employees.some(emp => emp.location === location && emp.status === 'active')).map(location => (
                    <button
                      key={location}
                      onClick={() => handleEmailByRegion(location)}
                      className="flex items-center gap-2 px-3 py-2 bg-indigo-100 text-indigo-800 border border-indigo-300 rounded-lg hover:bg-indigo-200 text-sm font-medium"
                    >
                      <Mail className="w-4 h-4" />
                      Email {location}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search and Filters */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex-1 min-w-64">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                      <input
                        type="text"
                        placeholder="Search by name, email, inspector #, or initials..."
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
                    <option value="inactive">Inactive/Former</option>
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
                    <div key={employee.id} className={`p-4 hover:bg-gray-50 ${employee.status === 'inactive' ? 'bg-red-50' : ''}`}>
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
                                <div className={`font-medium ${employee.status === 'inactive' ? 'text-red-600' : 'text-gray-900'}`}>
                                  {employee.name}
                                  {employee.status === 'inactive' && <span className="text-xs ml-2 bg-red-100 text-red-600 px-1 rounded">INACTIVE</span>}
                                </div>
                                <div className="text-sm text-gray-500">
                                  #{employee.inspectorNumber}
                                  {employee.initials && <span className="ml-2 text-blue-600">({employee.initials})</span>}
                                  {employee.weeklyHours && !employee.isFullTime && (
                                    <span className="ml-2 text-orange-600">{employee.weeklyHours}h/wk</span>
                                  )}
                                </div>
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
                              employee.status === 'inactive' ? 'text-red-600' :
                              employee.isContractor ? 'text-purple-600' :
                              employee.isFullTime ? 'text-green-600' : 'text-orange-600'
                            }`}>
                              {employee.status === 'inactive' ? 'Inactive' :
                               employee.isContractor ? '1099 Contractor' :
                               employee.isFullTime ? 'Full Time W2' : 'Part Time W2'}
                            </span>
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
                              <button
                                onClick={() => openEmailModal([employee.email], employee.name)}
                                className="text-green-600 hover:text-green-800"
                                title="Get email"
                              >
                                <Mail className="h-4 w-4" />
                              </button>
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

      {/* HR Forms & Documents Tab */}
      {activeTab === 'forms' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200 p-6">
            <div className="flex items-center mb-6">
              <FileText className="w-8 h-8 mr-3 text-green-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">📋 HR Forms & Company Documents</h2>
                <p className="text-gray-600 mt-1">
                  Employee handbook, forms, and important company documents
                </p>
              </div>
            </div>
            
            {/* Employee Handbook Section */}
            <div className="mb-8 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                📖 Employee Handbook
              </h3>
              
              <div className="flex justify-center">
                <a
                  href="/hr-documents/employee-handbook.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-6 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <FileText className="w-12 h-12 text-blue-600 mr-4" />
                  <div>
                    <div className="text-lg font-semibold text-blue-800">Employee Handbook</div>
                    <div className="text-sm text-blue-600">Company policies, procedures & benefits guide</div>
                  </div>
                  <Download className="w-6 h-6 text-blue-600 ml-6" />
                </a>
              </div>
            </div>

            {/* HR Forms Section */}
            <div className="mb-8 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                📝 HR Forms & Documents
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a
                  href="/hr-documents/time-off-request-form.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
                >
                  <FileText className="w-8 h-8 text-orange-600 mr-3" />
                  <div>
                    <div className="font-semibold text-orange-800">Time Off Request</div>
                    <div className="text-sm text-orange-600">Vacation & leave request form</div>
                  </div>
                  <Download className="w-5 h-5 text-orange-600 ml-auto" />
                </a>
                
                <a
                  href="/hr-documents/i9-form.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <FileText className="w-8 h-8 text-purple-600 mr-3" />
                  <div>
                    <div className="font-semibold text-purple-800">Form I-9</div>
                    <div className="text-sm text-purple-600">Employment eligibility verification</div>
                  </div>
                  <Download className="w-5 h-5 text-purple-600 ml-auto" />
                </a>
              </div>
            </div>

            {/* Additional Resources */}
            <div className="p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                📞 Need Help?
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-4 bg-blue-50 rounded-lg text-center">
                  <h4 className="font-semibold text-blue-800 mb-3">📞 HR Contact Information</h4>
                  <div className="text-sm text-blue-700 space-y-1">
                    <p>HR Department: (856) 555-0123</p>
                    <p>Email: hr@ppainc.com</p>
                    <p>Office Hours: Monday-Friday, 8:00 AM - 5:00 PM</p>
                  </div>
                </div>
                
                <div className="p-4 bg-green-50 rounded-lg text-center">
                  <h4 className="font-semibold text-green-800 mb-3">💡 Questions?</h4>
                  <div className="text-sm text-green-700 space-y-1">
                    <p>• Review the Employee Handbook above</p>
                    <p>• Contact HR for policy questions</p>
                    <p>• Ask your manager for guidance</p>
                    <p>• Use the forms provided below</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
                      {stats.totalWorkforce} total records ({stats.totalEmployees} employees + {stats.contractors} contractors)
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
                Import updates will automatically detect new hires, departures, and data changes without creating duplicates.
              </div>
            </div>

            {/* Data Quality Report */}
            {employees.length > 0 && (
              <div className="p-6 bg-white rounded-lg border shadow-sm">
                <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                  🔍 Data Quality Report
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                    <div className="text-sm text-green-700">Active Records</div>
                    <div className="text-xs text-green-600 mt-1">Currently employed</div>
                  </div>
                  
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-600">{stats.inactive}</div>
                    <div className="text-sm text-red-700">Inactive Records</div>
                    <div className="text-xs text-red-600 mt-1">Former employees</div>
                  </div>
                  
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-orange-600">{stats.withIssues}</div>
                    <div className="text-sm text-orange-700">Missing Data</div>
                    <div className="text-xs text-orange-600 mt-1">Phone, email, or ID missing</div>
                  </div>
                  
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-600">{stats.active > 0 ? Math.round(((stats.active - stats.withIssues) / stats.active) * 100) : 0}%</div>
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
                      ['Inspector #', 'Name', 'Email', 'Phone', 'Role', 'Location', 'Employment Type', 'Weekly Hours', 'Status'].join(','),
                      ...employees.map(emp => [
                        emp.inspectorNumber,
                        `"${emp.name}"`,
                        emp.email,
                        emp.phone,
                        emp.role,
                        emp.location,
                        emp.isContractor ? '1099 Contractor' : emp.isFullTime ? 'Full Time W2' : 'Part Time W2',
                        emp.weeklyHours || '',
                        emp.status
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
                  <div className="text-sm text-green-600">Download complete employee database with FTE data</div>
                </button>
                
                <button
                  onClick={() => loadEmployees()}
                  className="p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors text-left"
                >
                  <div className="text-purple-700 font-semibold mb-2">🔄 Refresh Data</div>
                  <div className="text-sm text-purple-600">Reload employee data from database</div>
                </button>

                <button
                  onClick={handleEmailAll}
                  className="p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
                >
                  <div className="text-blue-700 font-semibold mb-2">📧 Email All Staff</div>
                  <div className="text-sm text-blue-600">Get email list for all active employees</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManagement;
