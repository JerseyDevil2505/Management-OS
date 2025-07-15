import React, { useState } from 'react';
import PayrollProductionUpdater from './components/PayrollProductionUpdater';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import './App.css';

function App() {
  const [activeModule, setActiveModule] = useState('employees'); // Changed default to employees

  return (
    <div className="App">
      {/* Top Navigation */}
      <div className="bg-gray-900 text-white p-4 mb-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">PPA Management OS</h1>
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
            <button
              onClick={() => setActiveModule('production')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeModule === 'production'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📊 Production Tracker
            </button>
          </nav>
        </div>
      </div>

      {/* Module Content */}
      <div className="min-h-screen bg-gray-50">
        {activeModule === 'employees' && <EmployeeManagement />}
        {activeModule === 'jobs' && <AdminJobManagement />}
        {activeModule === 'production' && <PayrollProductionUpdater />}
      </div>
    </div>
  );
}

export default App;
