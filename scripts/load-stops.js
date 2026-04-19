require('dotenv').config({ path: '../user-app/.env.local' });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// 1. Arguments check
const routeId = process.argv[2];
if (!routeId) {
  console.error("❌ Error: Missing route_id argument.");
  console.error("Usage: node load-stops.js <route_id>");
  process.exit(1);
}

// 2. Setup Supabase Client
// We use the Service Role Key to bypass RLS for inserting.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function loadStops() {
  try {
    const dataPath = './stops_tunja.json';
    
    // 3. Read the JSON file
    if (!fs.existsSync(dataPath)) {
      console.error(`❌ Error: ${dataPath} not found.`);
      console.error("Please export it from Overpass Turbo first.");
      process.exit(1);
    }

    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const overpassData = JSON.parse(rawData);

    // 4. Transform into Supabase table format
    const nodes = overpassData.elements.filter(el => el.type === 'node');
    if (nodes.length === 0) {
      console.log("⚠️ No stops found in the JSON file.");
      return;
    }

    const stopsToInsert = nodes.map((node, index) => {
      const stopName = (node.tags && node.tags.name) ? node.tags.name : "Paradero sin nombre";
      return {
        route_id: routeId,
        stop_name: stopName,
        stop_lat: node.lat,
        stop_lon: node.lon,
        stop_sequence: index + 1 // Starts at 1
      };
    });

    console.log(`Starting insertion of ${stopsToInsert.length} stops for Route: ${routeId}`);

    // 5. Insert directly bypassing RLS using the Service Role SDK instance
    const { data, error } = await supabase
      .from('stops')
      .insert(stopsToInsert)
      .select();

    if (error) throw error;

    console.log(`✅ Success! ${data.length} stops have been loaded into the database.`);
    
  } catch (error) {
    console.error("Fatal Error:", error.message);
  }
}

loadStops();
