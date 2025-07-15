import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService } from '../lib/supabaseClient';

const AdminJobManagement = () => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [currentUser, setCurrentUser] = useState({ role: 'admin', canAccessBilling: true });
  
  const [jobs, setJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  const [newJob, setNewJob] = useState({
    name: '',
    ccddCode: '',
    municipality: '',
    county: '',
    state: 'NJ',
    dueDate: '',
    assignedManagers: [],
    sourceFile: null,
    codeFile: null,
    vendor: null,
    vendorDetection: null
  });

  const [fileAnalysis, setFileAnalysis] = useState({
    sourceFile: null,
    codeFile: null,
    detectedVendor: null,
    isValid: false,
    propertyCount: 0,
    codeCount: 0,
    vendorDetails: null
  });

  const [dbConnected, setDbConnected] = useState(false);
  const [dbStats, setDbStats] = useState({ employees: 0, jobs: 0, propertyRecords: 0, sourceFiles: 0 });

  // Load real data from database
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);
        
        const connectionTest = await utilityService.testConnection();
        setDbConnected(connectionTest.success);
        
        if (connectionTest.success) {
          const [jobsData, planningData, managersData, statsData, userData] = await Promise.all([
            jobService.getAll(),
            planningJobService.getAll(),
            employeeService.getManagers(),
            utilityService.getStats(),
            authService.getCurrentUser()
          ]);
          
          setJobs(jobsData);
          setPlanningJobs(planningData);
          setManagers(managersData);
          setDbStats(statsData);
          setCurrentUser(userData || { role: 'admin', canAccessBilling: true });
        }
      } catch (error) {
        console.error('Data initialization error:', error);
        setDbConnected(false);
      } finally {
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  // Enhanced file analysis with live validation and debugging
  const analyzeFileWithProcessor = async (file, type) => {
    console.log('=== ANALYZE FILE DEBUG ===');
    console.log('Starting analysis for:', file.name, 'type:', type);
    
    if (!file) {
      console.log('No file provided!');
      return;
    }

    console.log('Reading file as text...');
    const text = await file.text();
    console.log('File text length:', text.length);
    console.log('First 200 characters:', text.substring(0, 200));
    
    let vendorResult = null;

    // Fix: Convert type names to match the conditions
    const fileType = type === 'sourceFile' ? 'source' : 'code';
    console.log('Converted file type:', fileType);

    if (fileType === 'source') {
      console.log('Analyzing as source file...');
      
      if (file.name.endsWith('.txt')) {
        console.log('File is .txt, checking for Microsystems format...');
        const lines = text.split('\n');
        console.log('Total lines:', lines.length);
        const headers = lines[0];
        console.log('Headers:', headers);
        
        if (headers.includes('Block|Lot|Qual') || headers.includes('|')) {
          console.log('Found pipe separators - this is Microsystems format!');
          const dataLines = lines.slice(1).filter(line => line.trim());
          const sampleLine = dataLines[0] || '';
          const pipeCount = (sampleLine.match(/\|/g) || []).length;
          
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 100,
            detectedFormat: 'Microsystems Text Delimited',
            fileStructure: `${pipeCount + 1} fields with pipe separators`,
            propertyCount: dataLines.length,
            isValid: true
          };
          
          console.log('Vendor result:', vendorResult);
        } else {
          console.log('No pipe separators found, not Microsystems format');
        }
      }
      else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
        console.log('File is CSV/Excel, checking for BRT format...');
        const lines = text.split('\n');
        const headers = lines[0];
        
        if (headers.includes('VALUES_LANDTAXABLEVALUE') || 
            headers.includes('PROPCLASS') || 
            headers.includes('LISTBY')) {
          console.log('Found BRT headers');
          const dataLines = lines.slice(1).filter(line => line.trim());
          const fieldCount = (headers.match(/,/g) || []).length + 1;
          
          vendorResult = {
            vendor: 'BRT',
            confidence: headers.includes('VALUES_LANDTAXABLEVALUE') ? 100 : 85,
            detectedFormat: 'BRT CSV Export',
            fileStructure: `${fieldCount} columns with standard BRT headers`,
            propertyCount: dataLines.length,
            isValid: true
          };
          
          console.log('Vendor result:', vendorResult);
        } else {
          console.log('No BRT headers found');
        }
      }
    } else if (fileType === 'code') {
      console.log('Analyzing as code file...');
      
      if (file.name.endsWith('.txt')) {
        const lines = text.split('\n').filter(line => line.trim());
        if (text.includes('120PV') || lines.some(line => /^\d{2,3}[A-Z]{1,3}/.test(line))) {
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 95,
            detectedFormat: 'Microsystems Code Definitions',
            fileStructure: `${lines.length} code definitions`,
            codeCount: lines.length,
            isValid: true
          };
          
          console.log('Code file vendor result:', vendorResult);
        }
      }
      else if (file.name.endsWith('.json') || text.includes('"02":"COLONIAL"')) {
        try {
          const parsed = JSON.parse(text);
          vendorResult = {
            vendor: 'BRT',
            confidence: 100,
            detectedFormat: 'BRT JSON Code Hierarchy',
            fileStructure: `JSON structure with ${Object.keys(parsed).length} categories`,
            codeCount: Object.keys(parsed).length,
            isValid: true
          };
          
          console.log('JSON code file vendor result:', vendorResult);
        } catch (e) {
          if (text.includes('COLONIAL')) {
            vendorResult = {
              vendor: 'BRT',
              confidence: 80,
              detectedFormat: 'BRT Text Code Export',
              fileStructure: 'Text format with code descriptions',
              codeCount: (text.match(/"/g) || []).length / 2,
              isValid: true
            };
            
            console.log('BRT text code file vendor result:', vendorResult);
          }
        }
      }
    }

    console.log('Final vendor result:', vendorResult);
    console.log('Updating file analysis state...');

    setFileAnalysis(prev => {
      const newState = {
        ...prev,
        [type === 'source' ? 'sourceFile' : 'codeFile']: file,
        detectedVendor: vendorResult?.vendor || null,
        isValid: vendorResult?.isValid || false,
        [type === 'source' ? 'propertyCount' : 'codeCount']: 
          vendorResult?.[type === 'source' ? 'propertyCount' : 'codeCount'] || 0,
        vendorDetails: vendorResult
      };
      
      console.log('New file analysis state:', newState);
      return newState;
    });

    if (vendorResult) {
      console.log('Updating newJob state with vendor info...');
      setNewJob(prev => {
        const newJobState = { 
          ...prev, 
          vendor: vendorResult.vendor,
          vendorDetection: vendorResult
        };
        
        console.log('New job state:', newJobState);
        return newJobState;
      });
    } else {
      console.log('No vendor result - not updating job state');
    }
    
    console.log('=== ANALYZE FILE COMPLETE ===');
  };

  const handleFileUpload = (e, type) => {
    console.log('=== FILE UPLOAD DEBUG ===');
    console.log('Event triggered for type:', type);
    console.log('Files array:', e.target.files);
    console.log('First file:', e.target.files[0]);
    
    const file = e.target.files[0];
    if (file) {
      console.log('File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
      
      // Convert short type names to full names for state
      const fullTypeName = type === 'source' ? 'sourceFile' : 'codeFile';
      console.log('Setting newJob with type:', fullTypeName);
      
      setNewJob(prev => ({ ...prev, [fullTypeName]: file }));
      analyzeFileWithProcessor(file, type);
    } else {
      console.log('No file found in event');
    }
  };
