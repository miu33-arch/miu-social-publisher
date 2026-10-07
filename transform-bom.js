import fs from 'fs';

// Read the CSV file
const csvContent = fs.readFileSync('MOMRAH-RYD-2026-04_BOM_SCHEDULE.csv', 'utf-8');
const lines = csvContent.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());

// Transform each row into the schema required by your Ingest Engine
const items = lines.slice(1).map((line, idx) => {
  const cols = line.split(',').map(c => c.trim());
  const row = {};
  headers.forEach((h, i) => row[h] = cols[i]);

  return {
    item_no: row['Item'] || row['item_no'] || `ITM-${String(idx + 1).padStart(3, '0')}`,
    description: row['Description'] || row['description'] || 'Industrial Material',
    material_spec: row['Material Spec'] || row['material_spec'] || '',
    hs_tariff_code: row['HS Code'] || row['hs_tariff_code'] || '8504.40.90',
    saber_regulated: true,
    cert_required: 'PCoC+SCoC',
    cartons: parseInt(row['Cartons'] || row['CTN'] || '1', 10),
    gross_weight_kg: parseFloat(row['Weight'] || row['gross_weight_kg'] || '10.0'),
    dimensions_cm: {
      l: parseFloat(row['L'] || '40'),
      w: parseFloat(row['W'] || '30'),
      h: parseFloat(row['H'] || '20')
    },
    fob_unit_price_cny: parseFloat(row['Unit Price'] || row['price'] || '100.0'),
    quantity: parseInt(row['Quantity'] || row['Qty'] || '1', 10)
  };
});

// Wrap with Soleil's live freight parameters
const payload = {
  shipment_id: "MOMRAH-RYD-2026-04",
  origin: "Shenzhen, CN",
  destination: "Riyadh, SA",
  mode: "OCEAN_LCL",
  incoterm: "DDP",
  items: items,
  rate_parameters: {
    ocean_cbm_rate_cny: 1880.0,
    air_kg_rate_cny: 46.0,
    last_mile_delivery_per_ctn_cny: 25.0,
    density_ratio_kg_per_cbm: 400.0,
    min_cbm: 1.0
  }
};

fs.writeFileSync('manifest-payload.json', JSON.stringify(payload, null, 2));
console.log('Successfully transformed to manifest-payload.json');