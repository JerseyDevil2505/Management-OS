import React, { useState } from 'react';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/FileUploadButton';
import './App.css';

function App() {
  const [activeModule, setActiveModule] = useState('employees');
  const [selectedJob, setSelectedJob] = useState(null); // For job-specific modules

  // Handle job selection from AdminJobManagement
  const handleJobSelect = (job) => {
    setSelectedJob(job);
    setActiveModule('job-modules'); // Switch to job-specific view
  };

  // Handle returning to jobs list
  const handleBackToJobs = () => {
    setSelectedJob(null);
    setActiveModule('jobs'); // Return to jobs list
  };

  // Handle file processing completion
  const handleFileProcessed = (fileType, fileName) => {
    console.log(`File processed: ${fileType} - ${fileName}`);
    // Could trigger refresh of job data or notify active modules
  };

  return (
    <div className="App">
      {/* Top Navigation */}
      <div className="bg-gray-900 text-white p-4 mb-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">PPA Management OS</h1>
          
          {/* Only show main navigation when NOT in job-specific modules */}
          {activeModule !== 'job-modules' && (
            <nav className="flex space-x-6">
              <button
                onClick={() => setActiveModule('employees')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'employees'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                👥 Employee Management
              </button>
              <button
                onClick={() => setActiveModule('jobs')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'jobs'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                📋 Current Jobs
              </button>
            </nav>
          )}
          
          {/* Show job context when in job-specific modules */}
          {activeModule === 'job-modules' && selectedJob && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-sm text-gray-300">Working on:</p>
                  <p className="text-lg font-semibold">{selectedJob.job_name}</p>
                </div>
                
                {/* File Upload Controls */}
                <div className="border-l border-gray-700 pl-6">
                  <FileUploadButton 
                    job={selectedJob} 
                    onFileProcessed={handleFileProcessed} 
                  />
                </div>
              </div>
              
              <button
                onClick={handleBackToJobs}
                className="px-4 py-2 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-lg font-medium transition-colors"
              >
                ← Back to Jobs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Module Content */}
      <div className="min-h-screen bg-gray-50">
        {activeModule === 'employees' && <EmployeeManagement />}
        
        {activeModule === 'jobs' && (
          <AdminJobManagement onJobSelect={handleJobSelect} />
        )}
        
        {activeModule === 'job-modules' && (
          <JobContainer 
            selectedJob={selectedJob} 
            onBackToJobs={handleBackToJobs}
          />
        )}
      </div>
    </div>
  );
}

export default App;
