import { GoogleGenAI } from "@google/genai";
import puppeteer from "puppeteer";
import path from "path";

const ai = new GoogleGenAI({});

const SECTOR_PROFILES = {
  architecture: {
    title: "ARCHITECTURAL & CIVIL SPECIFICATION",
    standards: "SASO, MOMRA, ASTM, SBC (Saudi Building Code), GB/T",
    jargon: "Curtain walls, structural glazing, profiles, finishes, cladding, thermal breaks"
  },
  mep_hvac: {
    title: "MEP & HVAC ENGINEERING SCHEDULE",
    standards: "ASHRAE, SASO, IEC, AHRI, SMACNA, ISO",
    jargon: "Ducting, airflow CFM, chillers, static pressure, electrical busbars, cable trays"
  },
  electronics: {
    title: "ELECTRONICS & HARDWARE PROCUREMENT",
    standards: "RoHS, CE, FCC, UL, IPC, ISO 9001",
    jargon: "SMT, PCB layers, microcontrollers, voltage tolerance, pinouts, IC ratings"
  },
  manufacturing: {
    title: "INDUSTRIAL MANUFACTURING & CNC BOM",
    standards: "ISO 2768, DIN, ASME, GB/T, SASO",
    jargon: "Machining tolerances, tensile yield, anodization, billet alloys, heat treatment"
  },
  furniture: {
    title: "COMMERCIAL FIT-OUT & FF&E SCHEDULE",
    standards: "BIFMA, FSC, SASO 2870, EN 1021",
    jargon: "Joinery, veneer, acoustic NRC, rub counts, fire retardancy, hardware fittings"
  },
  general: {
    title: "TECHNICAL SPECIFICATION & BILL OF MATERIALS",
    standards: "ISO, SASO, ASTM, CE, GB/T",
    jargon: "Material grading, dimensions, tolerances, quality certifications"
  }
};

/**
 * Multi-Domain Technical Spec & BOM Localization Engine
 * Supports Architecture, MEP, Industrial CNC, Electronics, and FF&E.
 * Compiles localized PDF submittals with bilingual factory cross-referencing and compliance disclaimers.
 */
export async function processTechnicalSpecSheet({
  rawData,
  sourceLang = "zh",
  targetLang = "ar",
  projectCode = "BOM-GCC-2026",
  sector = "architecture",
  includeOriginalSubtext = true
}) {
  const activeSector = SECTOR_PROFILES[sector] || SECTOR_PROFILES.general;

  const translationPrompt = `
You are an expert bilingual technical engineer and submittal specialist for the GCC and international markets.
Sector: ${activeSector.title}
Key Standards: ${activeSector.standards}
Domain Focus: ${activeSector.jargon}

Translate this technical payload from "${sourceLang}" to "${targetLang}":
1. Preserve all engineering tolerances (e.g. ±0.02mm), dimensions, alloy designations (e.g. 6063-T6), and compliance codes.
2. If targetLang is "ar" (Arabic), use standard GCC/Saudi SASO & MOMRA engineering terminology.
3. If targetLang is "en" (English), use standard international procurement terminology.
4. Output MUST strictly match this JSON schema:
{
  "documentTitle": "string",
  "sector": "string",
  "headers": {
    "itemNo": "string",
    "description": "string",
    "material": "string",
    "standard": "string"
  },
  "items": [
    {
      "code": "string",
      "name": "string",
      "details": "string",
      "material": "string",
      "standard": "string"
    }
  ]
}
`;

  const aiResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        text: `${translationPrompt}\n\nRAW_PAYLOAD:\n${JSON.stringify(rawData, null, 2)}`
      }
    ],
    config: { responseMimeType: "application/json" }
  });

  const localizedData = JSON.parse(aiResponse.text);
  const isRtl = targetLang === "ar";
  const timestamp = Date.now();
  const outputPath = path.resolve(`./outputs/spec_${projectCode}_${targetLang}_${timestamp}.pdf`);

  const rawItems = Array.isArray(rawData?.items) ? rawData.items : [];

  const htmlDoc = `
    <!DOCTYPE html>
    <html dir="${isRtl ? "rtl" : "ltr"}" lang="${targetLang}">
    <head>
      <meta charset="utf-8">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;600;700&display=swap">
      <style>
        :root {
          --font-body: ${isRtl ? "'Cairo', sans-serif" : targetLang === "zh" ? "'Noto Sans SC', sans-serif" : "'Inter', 'JetBrains Mono', sans-serif"};
          --font-mono: 'JetBrains Mono', monospace;
          --font-cn: 'Noto Sans SC', sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: var(--font-body);
          font-size: 0.82rem;
          line-height: 1.4;
          background: #ffffff;
          color: #0f172a;
          padding: 12mm 15mm;
        }
        .header {
          border-bottom: 2px solid #0284c7;
          padding-bottom: 12px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .doc-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .doc-meta {
          font-size: 0.72rem;
          color: #64748b;
          font-family: var(--font-mono);
          letter-spacing: 0.5px;
        }
        .sector-tag {
          font-size: 0.68rem;
          background: #f0f9ff;
          color: #0284c7;
          border: 1px solid #bae6fd;
          padding: 3px 8px;
          border-radius: 3px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .spec-grid {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          margin-top: 8px;
        }
        .spec-grid th, .spec-grid td {
          border: 1px solid #cbd5e1;
          padding: 8px 10px;
          text-align: start;
          vertical-align: top;
        }
        .spec-grid th {
          background: #f8fafc;
          color: #334155;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .code-cell {
          font-family: var(--font-mono);
          font-weight: 700;
          color: #0f172a;
          font-size: 0.78rem;
        }
        .primary-text {
          font-weight: 600;
          color: #0f172a;
        }
        .detail-text {
          font-size: 0.74rem;
          color: #475569;
          margin-top: 2px;
        }
        .sub-cn {
          font-family: var(--font-cn);
          font-size: 0.68rem;
          color: #94a3b8;
          margin-top: 2px;
          display: block;
        }
        .standard-pill {
          color: #059669;
          font-weight: 600;
          font-size: 0.74rem;
          font-family: var(--font-mono);
        }
        .legal-footer {
          margin-top: 24px;
          border-top: 1px solid #cbd5e1;
          padding-top: 10px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          font-size: 0.66rem;
          color: #64748b;
          line-height: 1.4;
        }
        .footer-meta {
          text-align: end;
          min-width: 160px;
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: #94a3b8;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="doc-title">${localizedData.documentTitle || activeSector.title}</div>
          <div class="doc-meta">REF: ${projectCode} // SYSTEM: ${sector.toUpperCase()} // LANG: ${targetLang.toUpperCase()}</div>
        </div>
        <div class="sector-tag">${activeSector.title}</div>
      </div>

      <table class="spec-grid">
        <thead>
          <tr>
            <th style="width: 12%;">${localizedData.headers?.itemNo || "ITEM"}</th>
            <th style="width: 48%;">${localizedData.headers?.description || "DESCRIPTION & SPECIFICATION"}</th>
            <th style="width: 20%;">${localizedData.headers?.material || "MATERIAL / GRADE"}</th>
            <th style="width: 20%;">${localizedData.headers?.standard || "COMPLIANCE"}</th>
          </tr>
        </thead>
        <tbody>
          ${(localizedData.items || []).map((row, idx) => {
            const rawRow = rawItems[idx] || {};

            // Deduplicate subtext: only render if original exists and differs from localized text
            const showSubName = Boolean(
              includeOriginalSubtext &&
              rawRow.name &&
              rawRow.name.trim().toLowerCase() !== (row.name || "").trim().toLowerCase()
            );
            const showSubDetails = Boolean(
              includeOriginalSubtext &&
              rawRow.details &&
              rawRow.details.trim().toLowerCase() !== (row.details || "").trim().toLowerCase()
            );
            const showSubMaterial = Boolean(
              includeOriginalSubtext &&
              rawRow.material &&
              rawRow.material.trim().toLowerCase() !== (row.material || "").trim().toLowerCase()
            );
            const showSubStandard = Boolean(
              includeOriginalSubtext &&
              rawRow.standard &&
              rawRow.standard.trim().toLowerCase() !== (row.standard || "").trim().toLowerCase()
            );

            return `
            <tr>
              <td class="code-cell">${row.code || rawRow.code || `0${idx + 1}`}</td>
              <td>
                <div class="primary-text">${row.name || ""}</div>
                ${showSubName ? `<span class="sub-cn">${rawRow.name}</span>` : ""}
                <div class="detail-text">${row.details || ""}</div>
                ${showSubDetails ? `<span class="sub-cn">${rawRow.details}</span>` : ""}
              </td>
              <td>
                <div class="primary-text">${row.material || ""}</div>
                ${showSubMaterial ? `<span class="sub-cn">${rawRow.material}</span>` : ""}
              </td>
              <td>
                <div class="standard-pill">${row.standard || rawRow.standard || "STANDARD"}</div>
                ${showSubStandard ? `<span class="sub-cn">${rawRow.standard}</span>` : ""}
              </td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>

      <footer class="legal-footer">
        <div style="flex: 1;">
          <strong>DISCLAIMER &amp; COMPLIANCE NOTICE:</strong>
          This technical specification and standard parity matrix are compiled for engineering coordination and municipal pre-submittal review. Final filing to official regulatory portals (MOMRAH / Balady / SABER / SASO) requires formal verification and endorsement by the licensed Engineer of Record.
        </div>
        <div class="footer-meta">
          <div>REF: ${projectCode}</div>
          <div>MIU SOVEREIGN CORE</div>
          <div>PAGE 1 OF 1</div>
        </div>
      </footer>
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setContent(htmlDoc, { waitUntil: "networkidle0" });
  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" }
  });
  await browser.close();

  return {
    success: true,
    outputPath,
    targetLang,
    sector,
    projectCode
  };
}