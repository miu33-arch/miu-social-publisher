import puppeteer from "puppeteer";
import path from "path";

export async function generatePitchOnePagerPdf({
  clientName = "TIER-1 GCC GENERAL CONTRACTOR",
  contactPerson = "Procurement & Engineering Directorate",
  agencyBrand = "MIU STUDIO // SOVEREIGN CORE",
  date = new Date().toISOString().split("T")[0],
  outputPath
}) {
  const finalPath = outputPath || path.resolve(`./outputs/capability_deck_${Date.now()}.pdf`);

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;700&display=swap">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
      body { font-size: 8pt; color: #0f172a; padding: 12mm 14mm; background: #fff; line-height: 1.35; }
      .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
      .title { font-size: 13pt; font-weight: 700; color: #000; letter-spacing: -0.5px; }
      .meta { font-family: 'JetBrains Mono', monospace; font-size: 7pt; color: #64748b; }
      .badge { background: #000; color: #fff; font-weight: 700; padding: 4px 8px; font-size: 7pt; font-family: 'JetBrains Mono', monospace; }
      .hero-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 14px; }
      .box { border: 1px solid #e2e8f0; padding: 10px; border-radius: 4px; background: #f8fafc; }
      .box-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #0284c7; margin-bottom: 4px; }
      .pillars { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .pillar-card { border: 1px solid #cbd5e1; padding: 8px; border-radius: 4px; }
      .pillar-num { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #059669; font-size: 7.5pt; }
      .pillar-name { font-size: 7.8pt; font-weight: 700; margin: 2px 0 4px; }
      .pillar-desc { font-size: 6.8pt; color: #475569; line-height: 1.3; }
      .pricing-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
      .pricing-table th, .pricing-table td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 7pt; }
      .pricing-table th { background: #f1f5f9; text-transform: uppercase; font-weight: 700; text-align: left; }
      .footer { border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 6.5pt; color: #64748b; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="title">${agencyBrand}</div>
        <div class="meta">CHINA–GCC MUNICIPAL ENGINEERING &amp; PROCUREMENT SOVEREIGN PIPELINE</div>
      </div>
      <div class="badge">AIR-GAPPED COMPLIANCE CORE</div>
    </div>

    <div class="hero-grid">
      <div class="box">
        <div class="box-title">Executive Summary</div>
        <p style="color: #334155; font-size: 7.2pt;">
          Proprietary digital engineering infrastructure converting Chinese factory production BOMs, architectural BIM assets, and cross-border trade contracts into verified MOMRAH/Balady submittals, SASO/SABER parity dossiers, and ZATCA Phase-2 tax settlement artifacts with zero third-party cloud data exposure.
        </p>
      </div>
      <div class="box" style="border-left: 3px solid #059669;">
        <div class="box-title" style="color: #059669;">Target Beneficiary</div>
        <div style="font-weight: 700; font-size: 7.5pt;">${clientName}</div>
        <div style="font-size: 6.8pt; color: #64748b;">Attn: ${contactPerson}</div>
        <div style="font-size: 6.8pt; color: #64748b; font-family: 'JetBrains Mono', monospace;">DATE: ${date}</div>
      </div>
    </div>

    <div style="font-weight: 700; font-size: 8pt; text-transform: uppercase; margin-bottom: 6px; color: #0f172a;">
      Six Core Engineering Capabilities
    </div>

    <div class="pillars">
      <div class="pillar-card">
        <div class="pillar-num">01 // BOM LOCALIZER</div>
        <div class="pillar-name">GB/T ⇄ SASO / ASTM</div>
        <div class="pillar-desc">Bidirectional submittal translation (ZH/EN/AR) mapping Chinese factory alloy codes directly to Saudi municipal standards.</div>
      </div>
      <div class="pillar-card">
        <div class="pillar-num">02 // REGULATORY MTC</div>
        <div class="pillar-name">SABER &amp; SASO Matrix</div>
        <div class="pillar-desc">Automated Material Test Certificate verification for 6063-T6 aluminum, structural steel, and insulated Low-E glazing.</div>
      </div>
      <div class="pillar-card">
        <div class="pillar-num">03 // LANDED ESTIMATION</div>
        <div class="pillar-name">FOB ➔ CIF Jeddah Engine</div>
        <div class="pillar-desc">Accurate landed trade computation factoring 5% GCC common customs tariff and 15% ZATCA VAT in SAR and CNY.</div>
      </div>
      <div class="pillar-card">
        <div class="pillar-num">04 // TELEMETRY HUD</div>
        <div class="pillar-name">Municipal Site Stamper</div>
        <div class="pillar-desc">FFmpeg drone inspection pipeline burning GPS coordinates, slab datum levels (+12.50m), and Balady licenses onto video passes.</div>
      </div>
      <div class="pillar-card">
        <div class="pillar-num">05 // 4D BIM SEQUENCING</div>
        <div class="pillar-name">Multi-Scene Concatenation</div>
        <div class="pillar-desc">Lossless concatenation of phased walkthrough renders for municipal verification and board presentations.</div>
      </div>
      <div class="pillar-card">
        <div class="pillar-num">06 // ZATCA COMMERCIAL</div>
        <div class="pillar-name">Trilingual Tax Invoicing</div>
        <div class="pillar-desc">Phase-2 compliant tax invoicing with 15% VAT calculation and multi-currency wire settlement schedules (SAR/USD/CNY).</div>
      </div>
    </div>

    <div style="font-weight: 700; font-size: 8pt; text-transform: uppercase; margin-bottom: 6px; color: #0f172a;">
      Commercial Engagement Framework
    </div>

    <table class="pricing-table">
      <thead>
        <tr>
          <th>Tier</th>
          <th>Pricing</th>
          <th>Deliverables &amp; Scope</th>
          <th>Deployment Model</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Monthly Retainer</strong></td>
          <td>$3,500 / mo<br/><span style="color:#64748b; font-size:6.5pt;">(13,125 SAR)</span></td>
          <td>Turnkey BOM localizations, continuous SABER matrices, and ZATCA submittal filing packages.</td>
          <td>Cloud/Hybrid Managed</td>
        </tr>
        <tr>
          <td><strong>Project Dossier</strong></td>
          <td>$1,850 / pack<br/><span style="color:#64748b; font-size:6.5pt;">(6,937.5 SAR)</span></td>
          <td>Single-phase complete municipal submittal bundle, CIF cost breakdown, and stamped drone pass.</td>
          <td>Per Submittal Basis</td>
        </tr>
        <tr>
          <td><strong>Enterprise Core</strong></td>
          <td>$8,500 on-prem<br/><span style="color:#64748b; font-size:6.5pt;">(31,875 SAR)</span></td>
          <td>Air-gapped self-hosted node, direct Revit/ERP ingestion pipeline, multi-seat contractor licensing.</td>
          <td>100% Air-Gapped Local</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <div>REGULATORY DISCLAIMER: Prepared for engineering and procurement coordination under MOMRAH &amp; ZATCA guidelines.</div>
      <div style="font-family:'JetBrains Mono', monospace;">DOC: MIU-EXEC-CAPABILITY-2026</div>
    </div>
  </body>
  </html>
  `;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  await page.pdf({
    path: finalPath,
    format: "A4",
    printBackground: true,
    margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" }
  });
  await browser.close();

  return { outputPath: finalPath };
}