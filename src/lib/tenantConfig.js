/**
 * TENANT CONFIGURATION
 * ====================
 * Centralized configuration for multi-tenant behavior.
 * Controls module visibility, terminology, and behavior defaults
 * based on organization type (PPA vs LOJIK clients).
 *
 * org_type values in the organizations table:
 *   'internal'  → PPA Inc (reassessment/revaluation firm)
 *   'assessor'  → LOJIK clients (municipal assessors)
 */

export const PPA_ORG_ID = '00000000-0000-0000-0000-000000000001';

// --- Tenant Configurations keyed by org_type ---

const TENANT_CONFIGS = {
  // PPA Inc - full reassessment/revaluation firm features
  internal: {
    orgType: 'internal',
    productName: 'PPA Management OS',

    // Top-level nav modules (App.js)
    modules: {
      employees: true,
      billing: true,
      payroll: true,
      appealCoverage: true,
      organizations: true,
      revenue: true,
    },

    // Job-level module tabs (JobContainer)
    jobModules: {
      checklist: true,
      production: true,         // Full ProductionTracker with employee DB
      inspectionInfo: false,
      dataVisualizations: true,
      marketAnalysis: true,
      finalValuation: true,
    },

    // UI labels / terminology
    labels: {
      employees: 'Employees',
      employee: 'Employee',
      employeesTab: 'Employees',
      organizations: 'Organizations',
      organization: 'Organization',
      organizationsTab: 'Organizations',
      productionTab: 'ProductionTracker',
    },

    // Behavior defaults
    behavior: {
      autoNormalize: false,           // Manual normalization via button click
      defaultJobTab: 'checklist',     // Default tab when opening a job
    },
  },

  // LOJIK clients - municipal assessor features
  assessor: {
    orgType: 'assessor',
    productName: 'LOJIK Property Assessment',

    modules: {
      employees: false,               // No employee management
      billing: false,                  // No billing
      payroll: false,                  // No payroll
      appealCoverage: true,
      organizations: false,            // Managed as "Municipalities" via dashboard
      revenue: true,
    },

    jobModules: {
      checklist: false,                // Not needed unless reassessment
      production: false,               // Replaced by inspectionInfo
      inspectionInfo: true,            // Simplified inspection view with staff hints
      dataVisualizations: true,
      marketAnalysis: true,
      finalValuation: true,
    },

    labels: {
      employees: 'Staff',
      employee: 'Staff Member',
      employeesTab: 'Staff',
      organizations: 'Municipalities',
      organization: 'Municipality',
      organizationsTab: 'Municipalities',
      productionTab: 'Inspection Info',
    },

    behavior: {
      autoNormalize: false,            // No auto-normalize needed; Sales Review/CME use sales_price directly
      defaultJobTab: 'final-valuation',
    },
  },
};

// --- Helper Functions ---

/** Get tenant config for a given org_type string */
export function getTenantConfig(orgType) {
  return TENANT_CONFIGS[orgType] || TENANT_CONFIGS.internal;
}

/** Determine if a job belongs to PPA */
export function isPpaJob(job) {
  return !job.organization_id || job.organization_id === PPA_ORG_ID;
}

/** Get tenant config for a specific job */
export function getJobTenantConfig(job) {
  if (isPpaJob(job)) {
    return TENANT_CONFIGS.internal;
  }
  // All non-PPA jobs are LOJIK/assessor jobs
  return TENANT_CONFIGS.assessor;
}

/** Get tenant config for the current user based on their employee record */
export function getUserTenantConfig(user) {
  const userOrgId = user?.employeeData?.organization_id;
  if (!userOrgId || userOrgId === PPA_ORG_ID) {
    return TENANT_CONFIGS.internal;
  }
  return TENANT_CONFIGS.assessor;
}

/** Check if a nav module should be visible for a given tenant config */
export function isModuleVisible(tenantConfig, moduleKey) {
  return tenantConfig?.modules?.[moduleKey] ?? true;
}

/** Check if a job module tab should be visible for a given tenant config */
export function isJobModuleVisible(tenantConfig, moduleKey) {
  return tenantConfig?.jobModules?.[moduleKey] ?? true;
}

/** Get a label from the tenant config with fallback */
export function getLabel(tenantConfig, labelKey, fallback) {
  return tenantConfig?.labels?.[labelKey] || fallback || labelKey;
}
