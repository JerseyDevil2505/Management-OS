import { createClient } from 'jsr:@supabase/supabase-js@2';

// Helper to check if a raw code matches any configured codes
// Handles both formats: "02" matches "2 - CONC PATIO" or just "2"
function codeMatches(rawCode: string | null, configuredCodes: string[]): boolean {
  if (!rawCode || !configuredCodes || configuredCodes.length === 0) {
    return false;
  }

  // Normalize raw code: remove leading zeros and trim
  const normalizedRaw = String(rawCode).replace(/^0+/, '') || '0';

  return configuredCodes.some(configCode => {
    if (!configCode) return false;

    // Extract just the code portion before " - " if it exists
    const codePart = String(configCode).split(' - ')[0].trim();

    // Normalize configured code: remove leading zeros
    const normalizedConfig = codePart.replace(/^0+/, '') || '0';

    return normalizedRaw === normalizedConfig;
  });
}

Deno.serve(async (req: Request) => {
  try {
    // Parse request body
    const { jobId, vendorType, codeConfig } = await req.json();
    
    if (!jobId || !vendorType || !codeConfig) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: jobId, vendorType, codeConfig' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`🔄 Starting recategorization for job ${jobId} (${vendorType})`);
    console.log('📋 Code configuration:', codeConfig);

    // Fetch all properties for this job
    const { data: properties, error: fetchError } = await supabase
      .from('property_records')
      .select('id, property_block, property_lot, detached_item_code1, detached_item_code2, detached_item_code3, detached_item_code4, detachedbuilding1, detachedbuilding2, detachedbuilding3, detachedbuilding4, width1, depth1, width2, depth2, width3, depth3, width4, depth4, widthn1, depthn1, widthn2, depthn2, widthn3, depthn3, widthn4, depthn4, detachedcode_1, detachedcode_2, detachedcode_3, detachedcode_4, detachedcode_5, detachedcode_6, detachedcode_7, detachedcode_8, detachedcode_9, detachedcode_10, detachedcode_11, detacheddcsize_1, detacheddcsize_2, detacheddcsize_3, detacheddcsize_4, detacheddcsize_5, detacheddcsize_6, detacheddcsize_7, detacheddcsize_8, detacheddcsize_9, detacheddcsize_10, detacheddcsize_11, attachedcode_1, attachedcode_2, attachedcode_3, attachedcode_4, attachedcode_5, attachedcode_6, attachedcode_7, attachedcode_8, attachedcode_9, attachedcode_10, attachedcode_11, attachedcode_12, attachedcode_13, attachedcode_14, attachedcode_15, attachedarea_1, attachedarea_2, attachedarea_3, attachedarea_4, attachedarea_5, attachedarea_6, attachedarea_7, attachedarea_8, attachedarea_9, attachedarea_10, attachedarea_11, attachedarea_12, attachedarea_13, attachedarea_14, attachedarea_15')
      .eq('job_id', jobId);

    if (fetchError) {
      throw new Error(`Failed to fetch properties: ${fetchError.message}`);
    }

    console.log(`📊 Found ${properties.length} properties to recategorize`);

    // Process each property and build updates
    const updates: any[] = [];
    
    for (const property of properties) {
      const update: any = { id: property.id };
      let hasUpdates = false;

      if (vendorType === 'Microsystems') {
        // MICROSYSTEMS: Recategorize detached items from detached_item_code1-4, detachedbuilding1-4
        const detGarageCodes = codeConfig.det_garage || [];
        const poolCodes = codeConfig.pool || [];
        const barnCodes = codeConfig.barn || [];
        const stableCodes = codeConfig.stable || [];
        const poleBarnCodes = codeConfig.pole_barn || [];
        const miscCodes = codeConfig.miscellaneous || [];
        const landPosCodes = codeConfig.land_positive || [];
        const landNegCodes = codeConfig.land_negative || [];

        let detGarageArea = 0;
        let poolArea = 0;
        let barnArea = 0;
        let stableArea = 0;
        let poleBarnArea = 0;
        const miscFound: string[] = [];
        const landPosFound: string[] = [];
        const landNegFound: string[] = [];

        // Process detached_item_code1-4
        for (let i = 1; i <= 4; i++) {
          const code = property[`detached_item_code${i}`];
          if (!code) continue;

          // Calculate area from width/depth or use direct value
          let area = 0;
          const width = property[`width${i}`];
          const depth = property[`depth${i}`];
          if (width && depth) {
            area = width * depth;
          }

          if (area > 0) {
            if (codeMatches(code, detGarageCodes)) detGarageArea += area;
            else if (codeMatches(code, poolCodes)) poolArea += area;
            else if (codeMatches(code, barnCodes)) barnArea += area;
            else if (codeMatches(code, stableCodes)) stableArea += area;
            else if (codeMatches(code, poleBarnCodes)) poleBarnArea += area;
          }
        }

        // Process detachedbuilding1-4
        for (let i = 1; i <= 4; i++) {
          const code = property[`detachedbuilding${i}`];
          if (!code) continue;

          // Calculate area from widthn/depthn
          let area = 0;
          const width = property[`widthn${i}`];
          const depth = property[`depthn${i}`];
          if (width && depth) {
            area = width * depth;
          }

          if (area > 0) {
            if (codeMatches(code, detGarageCodes)) detGarageArea += area;
            else if (codeMatches(code, poolCodes)) poolArea += area;
            else if (codeMatches(code, barnCodes)) barnArea += area;
            else if (codeMatches(code, stableCodes)) stableArea += area;
            else if (codeMatches(code, poleBarnCodes)) poleBarnArea += area;
          }
        }

        // Set update values
        update.det_garage_area = detGarageArea > 0 ? detGarageArea : null;
        update.pool_area = poolArea > 0 ? poolArea : null;
        update.barn_area = barnArea > 0 ? barnArea : null;
        update.stable_area = stableArea > 0 ? stableArea : null;
        update.pole_barn_area = poleBarnArea > 0 ? poleBarnArea : null;
        hasUpdates = true;

      } else if (vendorType === 'BRT') {
        // BRT: Recategorize from detachedcode_1-11 and attachedcode_1-15
        const detGarageCodes = codeConfig.det_garage || [];
        const poolCodes = codeConfig.pool || [];
        const barnCodes = codeConfig.barn || [];
        const stableCodes = codeConfig.stable || [];
        const poleBarnCodes = codeConfig.pole_barn || [];
        const garageCodes = codeConfig.garage || [];
        const deckCodes = codeConfig.deck || [];
        const patioCodes = codeConfig.patio || [];
        const openPorchCodes = codeConfig.open_porch || [];
        const enclosedPorchCodes = codeConfig.enclosed_porch || [];

        let detGarageArea = 0;
        let poolArea = 0;
        let barnArea = 0;
        let stableArea = 0;
        let poleBarnArea = 0;
        let garageArea = 0;
        let deckArea = 0;
        let patioArea = 0;
        let openPorchArea = 0;
        let enclosedPorchArea = 0;

        // Process detached items (detachedcode_1-11)
        for (let i = 1; i <= 11; i++) {
          const code = property[`detachedcode_${i}`];
          const area = property[`detacheddcsize_${i}`];
          
          if (!code || !area || area <= 0) continue;

          if (codeMatches(code, detGarageCodes)) detGarageArea += area;
          else if (codeMatches(code, poolCodes)) poolArea += area;
          else if (codeMatches(code, barnCodes)) barnArea += area;
          else if (codeMatches(code, stableCodes)) stableArea += area;
          else if (codeMatches(code, poleBarnCodes)) poleBarnArea += area;
        }

        // Process attached items (attachedcode_1-15)
        for (let i = 1; i <= 15; i++) {
          const code = property[`attachedcode_${i}`];
          const area = property[`attachedarea_${i}`];
          
          if (!code || !area || area <= 0) continue;

          if (codeMatches(code, garageCodes)) garageArea += area;
          else if (codeMatches(code, deckCodes)) deckArea += area;
          else if (codeMatches(code, patioCodes)) patioArea += area;
          else if (codeMatches(code, openPorchCodes)) openPorchArea += area;
          else if (codeMatches(code, enclosedPorchCodes)) enclosedPorchArea += area;
        }

        // Set update values
        update.det_garage_area = detGarageArea > 0 ? detGarageArea : null;
        update.pool_area = poolArea > 0 ? poolArea : null;
        update.barn_area = barnArea > 0 ? barnArea : null;
        update.stable_area = stableArea > 0 ? stableArea : null;
        update.pole_barn_area = poleBarnArea > 0 ? poleBarnArea : null;
        update.garage_area = garageArea > 0 ? garageArea : null;
        update.deck_area = deckArea > 0 ? deckArea : null;
        update.patio_area = patioArea > 0 ? patioArea : null;
        update.open_porch_area = openPorchArea > 0 ? openPorchArea : null;
        update.enclosed_porch_area = enclosedPorchArea > 0 ? enclosedPorchArea : null;
        hasUpdates = true;
      }

      if (hasUpdates) {
        updates.push(update);
      }
    }

    console.log(`💾 Updating ${updates.length} properties`);

    // Batch update properties (chunk into batches of 100)
    const BATCH_SIZE = 100;
    let updatedCount = 0;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      const { error: updateError } = await supabase
        .from('property_records')
        .upsert(batch, { onConflict: 'id' });

      if (updateError) {
        console.error(`❌ Batch update error:`, updateError);
        throw new Error(`Failed to update properties: ${updateError.message}`);
      }

      updatedCount += batch.length;
      console.log(`✅ Updated ${updatedCount}/${updates.length} properties`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
        message: `Successfully recategorized ${updatedCount} properties for ${vendorType}`
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' }
      }
    );

  } catch (error) {
    console.error('❌ Recalculation error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});
