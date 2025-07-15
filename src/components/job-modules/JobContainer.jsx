import React, { useState, useEffect } from 'react';
import { ArrowLeft, Building, Factory, TrendingUp, DollarSign, Scale } from 'lucide-react';
import ManagementChecklist from './ManagementChecklist';
import PayrollProductionUpdater from './PayrollProductionUpdater';
import MarketAnalysis from './MarketAnalysis';
import FinalValuation from './FinalValuation';
import AppealCoverage from './AppealCoverage';

const JobContainer = ({ selectedJob, onBackToJobs }) => {
  const [activeModule, setActiveModule] = useState('checklist');
  const [jobData, setJobData] = useState(null);

  useEffect(() => {
    if (selectedJob) {
      // Prepare job data with resolved manager name
      // In real implementation, you'd join with employees table to get manager name
      const enrichedJobData = {
        ...selectedJob,
        manager_name: 'Manager Name Here', // TODO: Resolve from employees table using assigned_manager UUID
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD'
      };
      setJobData(enrichedJobData);
    }
  }, [selectedJob]);

  if (!selectedJob) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="text-center text-gray-500 py-12">
          <Building className="w-16 h-16 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Job Selected</h3>
          <p>Please select a job from the Job Management to access modules.</p>
        </div>
      </div>
    );
  }

  const modules = [
    {
      id: 'checklist',
      name: 'Checklist',
      icon: Building,
      component: ManagementChecklist,
      description: 'Project checklist and documentation'
    },
    {
      id: 'production',
      name: 'Production',
      icon: Factory,
      component: PayrollProductionUpdater,
      description: 'Payroll and production tracking'
    },
    {
      id: 'market-analysis',
      name: 'Market & Land Analysis',
      icon: TrendingUp,
      component: MarketAnalysis,
      description: 'Market analysis and land valuation'
    },
    {
      id: 'final-valuation',
      name: 'Final Valuation',
      icon: DollarSign,
      component: FinalValuation,
      description: 'Final property valuations'
    },
    {
      id: 'appeal-coverage',
      name: 'Appeal Coverage',
      icon: Scale,
      component: AppealCoverage,
      description: 'Appeal management and coverage'
    }
  ];

  const activeModuleData = modules.find(m => m.id === activeModule);
  const ActiveComponent = activeModuleData?.component;

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Header with Back Button and Job Info */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToJobs}
            className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Jobs
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {selectedJob.job_name}
            </h1>
            <p className="text-gray-600">
              {selectedJob.client_name} • {selectedJob.municipality || 'Municipality TBD'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-blue-600">
            Due: {selectedJob.end_date ? new Date(selectedJob.end_date).toLocaleDateString() : 'TBD'}
          </p>
          <p className="text-xs text-gray-500">
            Status: {selectedJob.status || 'Active'}
          </p>
        </div>
      </div>

      {/* Module Navigation Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {modules.map((module) => {
              const IconComponent = module.icon;
              const isActive = activeModule === module.id;
              const isAvailable = module.component !== null;
              
              return (
                <button
                  key={module.id}
                  onClick={() => isAvailable && setActiveModule(module.id)}
                  disabled={!isAvailable}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : isAvailable
                      ? 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      : 'border-transparent text-gray-300 cursor-not-allowed'
                  }`}
                  title={!isAvailable ? 'Coming soon' : module.description}
                >
                  <IconComponent className="w-4 h-4" />
                  {module.name}
                  {!isAvailable && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full ml-1">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Active Module Content */}
      <div className="min-h-96">
        {ActiveComponent ? (
          <ActiveComponent
            jobData={jobData}
            onBackToJobs={onBackToJobs}
            activeSubModule={activeModule}
            onSubModuleChange={setActiveModule}
          />
        ) : (
          <div className="text-center text-gray-500 py-24">
            <div className="mb-4">
              {activeModuleData && <activeModuleData.icon className="w-16 h-16 mx-auto text-gray-400" />}
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {activeModuleData?.name} Coming Soon
            </h3>
            <p className="text-sm">
              {activeModuleData?.description} will be available in a future update.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default JobContainer;
