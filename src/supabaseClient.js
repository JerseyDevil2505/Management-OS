const processFiles = async () => {
    if (!csvFile) {
      alert('Please upload a CSV file');
      return;
    }

    if (!selectedJob) {
      alert('Please select a job first');
      return;
    }

    setProcessing(true);
    try {
      console.log('Starting file processing with Supabase...');
      
      // Read and parse CSV
      const csvText = await readFileAsText(csvFile);
      const Papa = window.Papa || await import('papaparse');
      const parsedData = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [',', '\t', '|', ';']
      });

      console.log('Parsed CSV data:', parsedData.data.length, 'records');

      // Create new source file version
      const fileVersion = await sourceFileService.createVersion(
        selectedJob.id,
        csvFile.name,
        csvFile.size,
        'admin-user-id' // TODO: Get actual user ID from auth
      );

      // Apply scrubbing
      const startDate = new Date(settings.startDate);
      const scrubbedData = scrubData(parsedData.data, startDate);
      
      // Import to database
      const importResult = await propertyService.importCSVData(
        selectedJob.id,
        fileVersion.id,
        scrubbedData,
        'admin-user-id' // TODO: Get actual user ID from auth
      );

      // Update file version with results
      await sourceFileService.updateVersion(fileVersion.id, {
        total_records: parsedData.data.length,
        records_processed: importResult.imported,
        processing_status: 'completed',
        processing_notes: `Successfully imported ${importResult.imported} of ${importResult.total} records`
      });

      // Update production summary
      await productionDataService.updateSummary(selectedJob.id);
      
      // Run validation
      const validationIssues = validateData(scrubbedData, settings.infoByCodeMappings);
      
      // Generate validation report
      const report = generateValidationReport(validationIssues);
      setValidationReport(report);
      
      // Calculate analytics
      const analytics = calculateAnalytics(scrubbedData, settings.infoByCodeMappings);
      
      // Add database info to results
      analytics.results.databaseInfo = {
        fileVersion: fileVersion.version_number,
        recordsImported: importResult.imported,
        totalRecords: importResult.total,
        jobId: selectedJob.id
      };
      
      setResults(analytics.results);
      setJobMetrics(analytics.metrics);
      setActiveTab('results');
      
      alert(`✅ Success! 
      
File Version: ${fileVersion.version_number}
Records Imported: ${importResult.imported}
Validation Issues: ${validationIssues.length}

Data saved to Supabase database!`);
      
    } catch (error) {
      console.error('Processing error:', error);
      alert(`❌ Error processing file: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };
