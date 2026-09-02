// services/docs/bomParser.js
import fs from "fs";
import * as XLSXModule from "xlsx";

// Normalize XLSX export across ESM / CommonJS module boundaries
const XLSX = XLSXModule.default || XLSXModule;

const HS_CODE_RULES = [
  { match: /(6063|ALUMINUM|铝)/i, hs: "7604.29.00", saso: "SASO 2831 / GB/T 5237", cat: "Facade Profiles" },
  { match: /(LOW-E|GLASS|玻)/i, hs: "7007.19.00", saso: "SASO ISO 12543 / ASTM C1036", cat: "Glazing Units" },
  { match: /(Q235|Q345|Q355|HRB400|STEEL|钢)/i, hs: "7216.33.00", saso: "SASO ASTM A36 / GB/T 700", cat: "Structural Steel" },
  { match: /(SEALANT|SILICONE|胶|ROCKWOOL|岩棉)/i, hs: "3214.10.00", saso: "ASTM C920 / SASO 2008", cat: "Weatherproofing & Insulation" }
];

export function parseSpreadsheetBOM(filePath) {
  // Read binary buffer via fs to bypass XLSX.readFile resolution issues
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  return rows.map((row, index) => {
    // Flexible header extraction for Chinese, English, and standard CSV formats
    const rawMaterial =
      row.Material ||
      row.Grade ||
      row.Standard_Grade ||
      row.Manufacturer_Origin ||
      row["材料"] ||
      row["材质"] ||
      "";

    const description =
      row.Description ||
      row.Description_EN_CN ||
      row.Name ||
      row.Item_Name ||
      row["名称"] ||
      `Item ${index + 1}`;

    const code =
      row.Code ||
      row.Item_No ||
      row["编号"] ||
      `BOM-${String(index + 1).padStart(3, "0")}`;

    // Auto-classify standard and HS code based on material or description matches
    const rule = HS_CODE_RULES.find(
      (r) => r.match.test(rawMaterial) || r.match.test(description)
    ) || {
      hs: "8487.90.00",
      saso: "SASO / ASTM Specified",
      cat: "General Architectural Element"
    };

    return {
      id: `ITEM-${String(index + 1).padStart(3, "0")}`,
      code: code,
      name: description,
      material: rawMaterial,
      techSpec: row.Standard_Grade || row.Specification || row["规格"] || rule.saso,
      quantity: Number(row.Qty || row.Quantity || row["数量"] || 1),
      unit: row.Unit || row["单位"] || "pcs",
      unitPriceUSD: Number(row.PriceUSD || row.UnitPrice || row.Unit_Price_USD || row["单价"] || 0),
      hsCode: rule.hs,
      sasoStandard: rule.saso,
      category: rule.cat
    };
  });
}