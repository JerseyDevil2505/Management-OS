# Next Session - Story Height Mapping Architecture

## Issue
Currently story height code mappings are global (job-level), but different VCS may have different position values for the same codes.

### Example Problem
- **VCS A**: Basement = Bottom Floor, 1st Floor = First Floor, Penthouse = Top
- **VCS B**: 1st Floor = Bottom Floor (no basement), 2nd Floor = First Floor, Penthouse = Top

Both may use the same story height codes (10, 11, 12) but interpret their positions differently.

## Current State
- Story height mappings stored in `jobs.story_height_config` (global JSONB)
- Baseline set to 1ST FLOOR, but seeing "Unknown" floors in Top and MAPL (need to investigate why)
- VCS cascade already exists in the codebase for other attributes

## Proposed Solution
Create a VCS-level cascade for story height code mappings instead of job-level:

### Option A: Add VCS-level Column
```sql
ALTER TABLE vcs_definitions ADD COLUMN story_height_config JSONB DEFAULT '{}';
```

### Option B: Create Lookup Table
```sql
CREATE TABLE vcs_story_height_mappings (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES jobs(id),
  vcs_code TEXT,
  story_height_code TEXT,
  floor_level TEXT,
  position TEXT (TOP/BOTTOM/MIDDLE),
  PRIMARY KEY (job_id, vcs_code, story_height_code)
);
```

## Benefits
- Allows different VCS to interpret the same story height code differently
- More accurate floor analysis per VCS
- Respects data vendor variations

## Investigation Needed
- Why are Top and MAPL showing "Unknown" floors when baseline is 1ST FLOOR?
- Verify if codes are being properly decoded/mapped
- Check if we need to expand position options beyond TOP/BOTTOM/MIDDLE

## Related Files
- `src/components/job-modules/market-tabs/OverallAnalysisTab.jsx` - Floor analysis and story height mapping UI
- Lines ~1400-1420 - Floor level determination logic
- Lines ~3950-4090 - Configuration modal and table
