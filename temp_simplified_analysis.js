// ============ ADDITIONAL CARDS ANALYSIS ============
  const runAdditionalCardAnalysis = async () => {
    setAdditionalWorking(true);
    try {
      // Get properties with normalized values
      const validProps = properties.filter(p => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        return marketData?.values_norm_time > 0;
      });

      console.log(`🔄 Starting SIMPLIFIED additional card analysis for ${validProps.length} properties with sales data`);

      // First, let's examine what's actually in the property_addl_card column
      const cardValues = validProps.map(p => p.property_addl_card).filter(card => card !== null && card !== undefined);
      const uniqueCards = [...new Set(cardValues)];
      console.log('📋 All unique property_addl_card values found:', uniqueCards);
      console.log('📋 Sample of properties with their card values:', 
        validProps.slice(0, 10).map(p => ({
          address: p.property_location,
          card: p.property_addl_card,
          vcs: p.new_vcs || p.property_vcs
        }))
      );

      // Simple helper function to determine if property has additional cards
      const hasAdditionalCard = (prop) => {
        const addlCard = prop.property_addl_card;
        if (!addlCard) return false;

        const cardStr = addlCard.toString().trim().toUpperCase();
        
        if (vendorType === 'BRT') {
          // BRT: anything other than '1' or 'M' or empty
          return cardStr !== '1' && cardStr !== 'M' && cardStr !== '' && cardStr !== 'MAIN';
        } else {
          // Microsystems: anything other than 'M' or 'MAIN' or empty
          return cardStr !== 'M' && cardStr !== 'MAIN' && cardStr !== '';
        }
      };

      // Simple categorization - no grouping, just direct property-by-property analysis
      const withAdditionalCards = [];
      const withoutAdditionalCards = [];

      validProps.forEach(p => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );

        if (!marketData?.values_norm_time) return;

        const propData = {
          ...p,
          values_norm_time: marketData.values_norm_time,
          sfla: p.asset_sfla || p.sfla || p.property_sfla || 0,
          year_built: p.asset_year_built || p.year_built || p.property_year_built || null,
          vcs: p.new_vcs || p.property_vcs || 'UNKNOWN',
          card: p.property_addl_card
        };

        if (hasAdditionalCard(p)) {
          withAdditionalCards.push(propData);
        } else {
          withoutAdditionalCards.push(propData);
        }
      });

      console.log(`📊 Categorized properties: ${withAdditionalCards.length} with additional cards, ${withoutAdditionalCards.length} without`);
      console.log('🔍 Sample properties WITH additional cards:', 
        withAdditionalCards.slice(0, 5).map(p => ({
          address: p.property_location,
          card: p.card,
          vcs: p.vcs
        }))
      );
      console.log('🔍 Sample properties WITHOUT additional cards:', 
        withoutAdditionalCards.slice(0, 5).map(p => ({
          address: p.property_location,
          card: p.card,
          vcs: p.vcs
        }))
      );

      // Group by VCS for analysis
      const byVCS = {};

      // Initialize VCS groups
      [...withAdditionalCards, ...withoutAdditionalCards].forEach(p => {
        if (!byVCS[p.vcs]) {
          byVCS[p.vcs] = { with_cards: [], without_cards: [] };
        }
      });

      // Populate VCS groups
      withAdditionalCards.forEach(p => {
        byVCS[p.vcs].with_cards.push(p);
      });

      withoutAdditionalCards.forEach(p => {
        byVCS[p.vcs].without_cards.push(p);
      });

      // Calculate statistics for each group
      const calculateStats = (properties) => {
        if (properties.length === 0) {
          return { n: 0, avg_price: null, avg_size: null, avg_age: null };
        }

        const avgPrice = properties.reduce((sum, p) => sum + p.values_norm_time, 0) / properties.length;
        
        const validSizes = properties.filter(p => p.sfla > 0);
        const avgSize = validSizes.length > 0 ?
          validSizes.reduce((sum, p) => sum + p.sfla, 0) / validSizes.length : null;

        const validYears = properties.filter(p => p.year_built && p.year_built > 1900 && p.year_built < 2030);
        const avgYear = validYears.length > 0 ?
          validYears.reduce((sum, p) => sum + p.year_built, 0) / validYears.length : null;
        const avgAge = avgYear ? new Date().getFullYear() - avgYear : null;

        return {
          n: properties.length,
          avg_price: Math.round(avgPrice),
          avg_size: avgSize ? Math.round(avgSize) : null,
          avg_age: avgAge ? Math.round(avgAge) : null
        };
      };

      // Build results structure
      const results = {
        byVCS: {},
        overall: { with: { n: 0 }, without: { n: 0 } },
        summary: {
          vendorType,
          totalPropertiesAnalyzed: validProps.length,
          propertiesWithCards: withAdditionalCards.length,
          propertiesWithoutCards: withoutAdditionalCards.length
        },
        generated_at: new Date().toISOString()
      };

      // Process each VCS
      Object.entries(byVCS).forEach(([vcs, data]) => {
        const withStats = calculateStats(data.with_cards);
        const withoutStats = calculateStats(data.without_cards);

        let flatAdj = null;
        let pctAdj = null;

        if (withStats.avg_price && withoutStats.avg_price) {
          flatAdj = Math.round(withStats.avg_price - withoutStats.avg_price);
          pctAdj = ((withStats.avg_price - withoutStats.avg_price) / withoutStats.avg_price) * 100;
        }

        results.byVCS[vcs] = {
          with: withStats,
          without: withoutStats,
          flat_adj: flatAdj,
          pct_adj: pctAdj
        };

        // Add to overall totals
        results.overall.with.n += withStats.n;
        results.overall.without.n += withoutStats.n;
      });

      console.log('📊 Final Analysis Results:', {
        vendorType,
        totalProperties: results.summary.totalPropertiesAnalyzed,
        withCards: results.summary.propertiesWithCards,
        withoutCards: results.summary.propertiesWithoutCards,
        cardDefinition: vendorType === 'BRT' ? 'Cards other than 1 or M' : 'Cards other than M or MAIN',
        uniqueCardValuesFound: uniqueCards
      });

      setAdditionalResults(results);

      // Save to database
      await saveAdditionalResultsToDB(results);

      console.log('✅ Simplified additional card analysis completed successfully');
      
    } catch (error) {
      console.error('Error running additional card analysis:', error);
    } finally {
      setAdditionalWorking(false);
    }
  };
