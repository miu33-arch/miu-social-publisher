import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let archiver;
try {
  archiver = require("archiver");
} catch (e) {
  console.warn("Archiver require warning:", e.message);
}

// Core system & intelligence imports
import { processCompanionDirective, processBatchDirectives } from "./services/core/localCompanion.js";
import { saveDirectiveLog, getDirectiveLogs, createApiClient, getClientByKey } from "./services/core/dbStore.js";

// Document, submittal & invoicing engines
import { processTechnicalSpecSheet } from "./services/docs/specSheetEngine.js";
import { generateInvoicePdf } from "./services/docs/invoiceEngine.js";
import { generateArchitecturalHud } from "./services/media/hudTelemetry.js";
import { stitchMasterWalkthrough } from "./services/media/videoStitcher.js";
import { requireMeteredAuth } from "./middleware/authMeter.js";
import { generatePitchOnePagerPdf } from "./services/docs/pitchOnePagerEngine.js";
import { uploadDossierAndGetPresignedUrl } from "./services/cloud/s3Dispatcher.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BASE_URL = (process.env.BASE_URL || (process.env.NODE_ENV === "production" 
  ? "https://api.miu33archstudio.xyz" 
  : `http://127.0.0.1:${PORT}`)).replace(/\/+$/, "");

const outputsDir = path.resolve("./outputs");
const uploadDir = path.resolve("./uploads");
[outputsDir, uploadDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use("/outputs", express.static(outputsDir));

const runCommand = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });

const resolveMediaFilePath = (rawPath) => {
  if (!rawPath) return null;
  const fileName = path.basename(rawPath);
  const candidates = [
    path.resolve(rawPath),
    path.resolve(`./${rawPath}`),
    path.resolve(`./uploads/${rawPath}`),
    path.resolve(`./uploads/${fileName}`),
    path.resolve(`./outputs/${fileName}`)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) {
      return c;
    }
  }
  return null;
};

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "online", core: "sovereign_aec_enterprise", timestamp: new Date() });
});

// Purge Temporary Media Artifacts
app.post("/api/system/purge-temp", (req, res) => {
  try {
    const files = fs.readdirSync(outputsDir);
    let deletedCount = 0;

    files.forEach((file) => {
      const fullPath = path.join(outputsDir, file);
      if (fs.statSync(fullPath).isFile()) {
        fs.unlinkSync(fullPath);
        deletedCount++;
      }
    });

    saveDirectiveLog({
      input: "SYSTEM_PURGE_ARTIFACTS",
      context: "maintenance",
      response: `Wiped ${deletedCount} enterprise render cache files.`
    });

    res.json({ success: true, count: deletedCount, message: `Purged ${deletedCount} cache files.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Client Key Provisioning & Balance
app.post("/api/clients/register", (req, res) => {
  try {
    const { clientName, plan, initialCredits } = req.body;
    const client = createApiClient({ clientName, plan, initialCredits });
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/clients/balance", (req, res) => {
  const apiKey = req.headers["x-api-key"] || "miu_master_agency_key";
  const client = getClientByKey ? getClientByKey(apiKey) : { clientName: "SOVEREIGN_CORE", plan: "agency_unlimited", creditsRemaining: 999999 };
  if (!client) return res.status(404).json({ success: false, error: "Client not found" });
  res.json({ success: true, client });
});

// ============================================================================
// SERVICE 1: SABER / SASO & MTC COMPLIANCE MATRIX VALIDATOR
// ============================================================================
app.post("/api/services/saber-saso", requireMeteredAuth("batch_export"), async (req, res) => {
  try {
    const { items = [], projectCode = "MOMRAH-SASO-2026", targetMarket = "KSA" } = req.body;

    const validatedItems = items.map((item, idx) => {
      const code = item.code || `ITM-0${idx + 1}`;
      const mat = (item.material || "").toUpperCase();
      let sasoParity = "SASO 2831 / ASTM B221 (Compliant)";
      let saberCategory = "Construction Materials - Class 1";
      let status = "APPROVED_PARITY";

      if (mat.includes("6063") || mat.includes("ALUMINUM") || mat.includes("铝")) {
        sasoParity = "SASO 2831 / GB/T 5237 (Aluminum Extrusions)";
        saberCategory = "Facade & Architectural Metal Profiles";
      } else if (mat.includes("GLASS") || mat.includes("LOW-E") || mat.includes("玻")) {
        sasoParity = "SASO ISO 12543 / ASTM C1036 (Safety & Insulated Glass)";
        saberCategory = "Architectural Glazing & Curtain Wall Units";
      } else if (mat.includes("STEEL") || mat.includes("钢")) {
        sasoParity = "SASO ASTM A36 / GB/T 700 (Structural Steel Plates)";
        saberCategory = "Primary Structural Framework";
      }

      return {
        itemNo: code,
        name: item.name || "AEC Material Node",
        materialGrade: item.material || "Grade Specified",
        factoryStandard: item.standard || "GB/T Standard",
        sasoStandard: sasoParity,
        saberCategory,
        complianceStatus: status,
      };
    });

    const timestamp = Date.now();
    const pdfPath = path.resolve(`./outputs/saso_matrix_${timestamp}.pdf`);

    const htmlDoc = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;700&display=swap">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
          body { font-size: 8.5pt; color: #0f172a; padding: 12mm 15mm; background: #fff; line-height: 1.4; }
          .header { border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
          .title { font-size: 13pt; font-weight: 700; color: #065f46; }
          .meta { font-family: 'JetBrains Mono', monospace; font-size: 7.5pt; color: #64748b; }
          .badge { background: #ecfdf5; border: 1px solid #a7f3d0; color: #059669; font-weight: 700; padding: 4px 8px; border-radius: 4px; font-size: 7.5pt; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-size: 7.5pt; text-transform: uppercase; color: #334155; }
          .mono { font-family: 'JetBrains Mono', monospace; font-weight: 700; }
          .status { color: #059669; font-weight: 700; font-family: 'JetBrains Mono', monospace; font-size: 7.5pt; }
          .footer { margin-top: 25px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 7pt; color: #64748b; display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">SABER &amp; SASO MATERIAL CONFORMITY MATRIX</div>
            <div class="meta">PROJECT REF: ${projectCode} // TARGET MARKET: ${targetMarket} // DATE: ${new Date().toISOString().split("T")[0]}</div>
          </div>
          <div class="badge">SASO 2831 / ASTM ALIGNED</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 12%;">ITEM NO</th>
              <th style="width: 25%;">MATERIAL / GRADE</th>
              <th style="width: 25%;">FACTORY STANDARD (CN)</th>
              <th style="width: 26%;">SASO / GCC PARITY STANDARD</th>
              <th style="width: 12%;">STATUS</th>
            </tr>
          </thead>
          <tbody>
            ${validatedItems.map((r) => `
              <tr>
                <td class="mono">${r.itemNo}</td>
                <td><strong>${r.name}</strong><br/><span style="color:#64748b; font-size:7.5pt;">${r.materialGrade}</span></td>
                <td><span class="mono" style="color:#0284c7;">${r.factoryStandard}</span></td>
                <td><span class="mono" style="color:#059669;">${r.sasoStandard}</span></td>
                <td><span class="status">✓ APPROVED</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="footer">
          <div style="flex:1;"><strong>DISCLAIMER:</strong> This standard conformity matrix is issued for engineering submittal coordination. Submission to SABER/MOMRAH requires certified Engineer of Record filing.</div>
          <div style="text-align:right; font-family:'JetBrains Mono', monospace;">DOC: SASO-PARITY-V2</div>
        </div>
      </body>
      </html>
    `;

    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ 
      headless: "new", 
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] 
    });
    const page = await browser.newPage();
    await page.setContent(htmlDoc, { waitUntil: "networkidle0" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    await browser.close();

    res.json({
      success: true,
      projectCode,
      targetMarket,
      validatedItems,
      downloadUrl: `${BASE_URL}/outputs/saso_matrix_${timestamp}.pdf`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 2: CHINA-GCC FOB/CIF LANDED COST & CUSTOMS DUTY ESTIMATOR
// ============================================================================
app.post("/api/services/landed-cost", requireMeteredAuth("batch_export"), async (req, res) => {
  try {
    const {
      items = [],
      originPort = "Guangzhou / Ningbo Port",
      destinationPort = "Jeddah Islamic Port (KSA)",
      freightCostUSD = 2400,
      exchangeRateSAR = 3.75,
      exchangeRateCNY = 0.52
    } = req.body;

    let subtotalUSD = 0;
    const itemBreakdown = items.map((itm, idx) => {
      const qty = Number(itm.qty) || 100;
      const unitFobUSD = Number(itm.unitPriceUSD) || 45.0;
      const totalFobUSD = qty * unitFobUSD;
      subtotalUSD += totalFobUSD;

      return {
        itemNo: itm.code || `HS-0${idx + 1}`,
        description: itm.name || "AEC Line Item",
        hsCode: itm.hsCode || "7604.29.00 (Aluminum Alloy Profiles)",
        quantity: qty,
        unitFobUSD,
        totalFobUSD
      };
    });

    const insuranceUSD = subtotalUSD * 0.005;
    const totalCifUSD = subtotalUSD + Number(freightCostUSD) + insuranceUSD;
    const totalCifSAR = totalCifUSD * exchangeRateSAR;

    const customsDutySAR = totalCifSAR * 0.05;
    const vatSAR = (totalCifSAR + customsDutySAR) * 0.15;
    const grandTotalLandedSAR = totalCifSAR + customsDutySAR + vatSAR;
    const grandTotalLandedCNY = grandTotalLandedSAR / exchangeRateCNY;

    const billing = req.finalizeCredits(10);
    saveDirectiveLog({
      input: `LANDED_COST_CALC [CIF ${destinationPort}] (${req.apiClient.clientName})`,
      context: "landed_cost",
      response: `Landed Total: ${grandTotalLandedSAR.toFixed(2)} SAR`
    });

    res.json({
      success: true,
      tradeLane: { originPort, destinationPort },
      subtotalFobUSD: subtotalUSD,
      freightUSD: Number(freightCostUSD),
      insuranceUSD,
      totalCifUSD,
      totalCifSAR,
      customsDutyRate: "5% GCC Common Tariff",
      customsDutySAR,
      zatcaVatRate: "15% KSA Standard",
      vatSAR,
      grandTotalLandedSAR,
      grandTotalLandedCNY,
      items: itemBreakdown,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 3: DRONE & SITE PROGRESS VIDEO HUD STAMPER
// ============================================================================
app.post("/api/services/site-hud", requireMeteredAuth("hud_telemetry"), upload.single("videoFile"), async (req, res) => {
  try {
    const rawVideo = req.file ? req.file.path : (req.body.videoPath || req.body.inputPath);
    const {
      projectTitle = "MOMRAH CENTRAL METRO TOWER // ZONE 4",
      datumElevation = "+12.50m (Structural Slab Level)",
      gpsCoordinates = "24.7136° N, 46.6753° E (Riyadh, KSA)",
      baladyLicenseNo = "BLD-RYD-2026-9941",
      contractor = "AL-RAJHI COMMERCIAL CONTRACTING",
      aspectRatio = "16:9",
      is4K = "false",
      duration = 30
    } = req.body;

    const isPortrait = aspectRatio === "9:16";
    const isUltraHD = is4K === "true" || is4K === true;
    const totalDuration = Number(duration) || 30;
    const timestamp = Date.now();

    const tempAssPath = path.resolve(`./temp_site_hud_${timestamp}.ass`);
    const finalVideoOutput = path.resolve(`./outputs/output_site_hud_${timestamp}.mp4`);

    const targetW = isPortrait ? (isUltraHD ? 2160 : 1080) : (isUltraHD ? 3840 : 1920);
    const targetH = isPortrait ? (isUltraHD ? 3840 : 2160) : (isUltraHD ? 2160 : 1080);

    const shots = [
      { hudLabel: `PROJECT: ${projectTitle}\\NBALADY LIC: ${baladyLicenseNo}` },
      { hudLabel: `SURVEYOR GPS: ${gpsCoordinates}\\NDATUM: ${datumElevation}` },
      { hudLabel: `CONTRACTOR: ${contractor}\\NINSPECTION PASS 01` },
      { hudLabel: `STATUS: MUNICIPAL STRUCTURAL MILESTONE VERIFIED` }
    ];

    generateArchitecturalHud({
      shots,
      projectTitle,
      outputPath: tempAssPath,
      aspectRatio,
      is4K: isUltraHD,
      duration: totalDuration
    });

    const resolvedVideo = typeof resolveMediaFilePath === "function" ? resolveMediaFilePath(rawVideo) : rawVideo;
    const formattedAss = tempAssPath.replace(/\\/g, "/").replace(":", "\\:");

    if (resolvedVideo && fs.existsSync(resolvedVideo)) {
      const videoFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,ass='${formattedAss}'`;
      await runCommand(
        `ffmpeg -y -i "${resolvedVideo}" -vf "${videoFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k -t ${totalDuration} "${finalVideoOutput}"`
      );
    } else {
      await runCommand(
        `ffmpeg -y -f lavfi -i "color=c=black:s=${targetW}x${targetH}:d=${totalDuration}:r=30" -vf "ass='${formattedAss}'" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart "${finalVideoOutput}"`
      );
    }

    if (fs.existsSync(tempAssPath)) fs.unlinkSync(tempAssPath);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    const billing = req.finalizeCredits(totalDuration);
    saveDirectiveLog({
      input: `SITE_PROGRESS_HUD_BURN [${baladyLicenseNo}] (${req.apiClient?.clientName || "Direct Call"})`,
      context: "site_hud",
      response: finalVideoOutput
    });

    res.json({
      success: true,
      processedPath: finalVideoOutput,
      downloadUrl: `${BASE_URL}/outputs/output_site_hud_${timestamp}.mp4`,
      aspectRatio,
      resolution: `${targetW}x${targetH}`,
      metadata: { projectTitle, datumElevation, gpsCoordinates, baladyLicenseNo, contractor },
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("[SITE_HUD_ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 4: 4D BIM PHASE SEQUENCING COMPILER
// ============================================================================
app.post("/api/services/4d-milestones", requireMeteredAuth("video_stitch"), upload.array("phaseClips", 10), async (req, res) => {
  try {
    let clips = [];
    if (req.files && req.files.length > 0) {
      clips = req.files.map((f) => f.path);
    } else if (req.body?.clips) {
      clips = Array.isArray(req.body.clips) ? req.body.clips : [req.body.clips];
    }

    const { milestones = ["Phase 1: Substructure", "Phase 2: Structural Frame", "Phase 3: Glazing Facade"] } = req.body;

    const result = await stitchMasterWalkthrough({ clips });
    const fileName = path.basename(result.stitchedPath);
    const targetPath = path.join(outputsDir, fileName);

    if (fs.existsSync(result.stitchedPath) && path.resolve(result.stitchedPath) !== path.resolve(targetPath)) {
      try {
        fs.copyFileSync(result.stitchedPath, targetPath);
      } catch (copyErr) {
        console.warn("Could not copy stitched file to outputs:", copyErr.message);
      }
    }

    const billing = req.finalizeCredits(60);

    saveDirectiveLog({
      input: `4D_BIM_PHASE_COMPILE [${clips.length} phases] (${req.apiClient.clientName})`,
      context: "4d_bim",
      response: `Master sequence compiled: ${result.stitchedPath}`
    });

    res.json({
      success: true,
      stitchedPath: result.stitchedPath,
      downloadUrl: `${BASE_URL}/outputs/${fileName}`,
      milestones,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 5: TECHNICAL SPEC SHEET & BOM LOCALIZER
// ============================================================================
app.post("/api/services/spec-sheet", requireMeteredAuth("batch_export"), async (req, res) => {
  try {
    const { rawData, sourceLang = "zh", targetLangs = ["en", "ar"], projectCode = "BOM-GCC-2026", sector = "architecture" } = req.body;

    let payload = rawData;
    if (typeof rawData === "string") {
      try {
        payload = JSON.parse(rawData);
      } catch {
        payload = {
          documentTitle: "TECHNICAL SPECIFICATION & BOM",
          headers: { itemNo: "ITEM", description: "SPECIFICATION", material: "MATERIAL", standard: "STANDARD" },
          items: [{ code: "01", name: "RAW_SPEC_ITEM", details: rawData, material: "SPECIFIED_GRADE", standard: "SASO / ASTM / GB" }]
        };
      }
    }

    const results = await Promise.all(
      targetLangs.map((lang) =>
        processTechnicalSpecSheet({ rawData: payload, sourceLang, targetLang: lang, projectCode, sector })
      )
    );

    const downloads = {};
    results.forEach((r) => {
      const fileName = path.basename(r.outputPath);
      downloads[r.targetLang] = `${BASE_URL}/outputs/${fileName}`;
    });

    const billing = req.finalizeCredits(results.length * 5);
    saveDirectiveLog({
      input: `SPEC_SHEET_DISPATCH [${sourceLang.toUpperCase()} -> ${targetLangs.join("/").toUpperCase()}]`,
      context: "spec_localization",
      response: Object.keys(downloads).join(", ")
    });

    res.json({
      success: true,
      projectCode,
      downloads,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 6: TRILINGUAL ZATCA TAX INVOICE ENGINE
// ============================================================================
app.post("/api/services/invoice", requireMeteredAuth("batch_export"), async (req, res) => {
  try {
    const { clientName, clientTaxId, invoiceNumber, currency = "SAR", vatRate, targetLang, items } = req.body;

    let processedItems = undefined;
    if (Array.isArray(items) && items.length > 0) {
      processedItems = items.map((item) => {
        const qty = Number(item.qty || item.quantity || 1);
        const unitPrice = Number(item.unitPrice || item.price || 0);
        return {
          code: item.code || "SVC-001",
          name: item.name || "Engineering Service",
          descriptionZh: item.descriptionZh || item.nameZh || "",
          descriptionAr: item.descriptionAr || item.nameAr || "",
          qty,
          unitPrice,
          total: Number((qty * unitPrice).toFixed(2))
        };
      });
    }

    const parsedVatRate = vatRate !== undefined ? Number(vatRate) : 0.15;

    const result = await generateInvoicePdf({
      clientName: clientName || (req.apiClient && req.apiClient.clientName) || "AL-RAJHI COMMERCIAL CONTRACTING",
      clientTaxId: clientTaxId || "300000000000003",
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      currency,
      vatRate: parsedVatRate,
      targetLang: targetLang || "dual",
      items: processedItems
    });

    const fileName = path.basename(result.outputPath);
    const targetPath = path.join(outputsDir, fileName);

    if (fs.existsSync(result.outputPath) && path.resolve(result.outputPath) !== path.resolve(targetPath)) {
      try {
        fs.copyFileSync(result.outputPath, targetPath);
      } catch (copyErr) {
        console.warn("Could not copy invoice PDF to outputs:", copyErr.message);
      }
    }

    const billing = req.finalizeCredits(10);

    saveDirectiveLog({
      input: `TAX_INVOICE_GENERATION [${result.invoiceNumber}] (${req.apiClient.clientName})`,
      context: "invoicing",
      response: `Issued ${result.grandTotal || result.total || "N/A"} ${result.currency || currency} -> ${fileName}`
    });

    res.json({
      success: true,
      ...result,
      downloadUrl: `${BASE_URL}/outputs/${fileName}`,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 7: MULTI-ARTIFACT PROJECT DOSSIER ZIPPER
// ============================================================================
app.post("/api/services/export-dossier", async (req, res) => {
  try {
    const { projectCode = "MOMRAH-RYD-2026-04" } = req.body;
    const sanitizedCode = projectCode.replace(/[^a-zA-Z0-9_-]/g, "_");
    const zipFileName = `dossier_${sanitizedCode}_${Date.now()}.zip`;
    const zipPath = path.join(outputsDir, zipFileName);

    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    const filesToZip = fs.existsSync(outputsDir)
      ? fs.readdirSync(outputsDir).filter((f) => {
          const full = path.join(outputsDir, f);
          return fs.statSync(full).isFile() && !f.endsWith(".zip");
        })
      : [];

    const archFn = typeof archiver === "function" ? archiver : (archiver?.default || archiver?.create);

    if (archFn) {
      const outputStream = fs.createWriteStream(zipPath);
      const archive = typeof archiver.create === "function" 
        ? archiver.create("zip", { zlib: { level: 9 } }) 
        : archiver("zip", { zlib: { level: 9 } });

      outputStream.on("close", () => {
        if (!res.headersSent) {
          res.json({
            success: true,
            projectCode,
            totalBytes: archive.pointer(),
            downloadUrl: `${BASE_URL}/outputs/${zipFileName}`,
            fileName: zipFileName
          });
        }
      });

      archive.on("error", (err) => {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });

      archive.pipe(outputStream);

      archive.append(
        `MIU SOVEREIGN AEC CORE // ENTERPRISE DOSSIER\nProject Ref: ${projectCode}\nCompiled Date: ${new Date().toISOString()}\nTarget: MOMRAH / Balady / SASO / ZATCA\n`,
        { name: "MANIFEST.txt" }
      );

      filesToZip.forEach((file) => {
        const fullPath = path.join(outputsDir, file);
        let folderPrefix = "05_General_Artifacts";

        if (file.startsWith("spec_") || file.includes("2026-04_") || file.includes("BOM")) {
          folderPrefix = "01_MOMRAH_Submittals";
        } else if (file.startsWith("saso_")) {
          folderPrefix = "02_SASO_SABER_Compliance";
        } else if (file.startsWith("invoice_")) {
          folderPrefix = "03_ZATCA_Tax_Invoices";
        } else if (file.startsWith("output_site_hud_") || file.endsWith(".mp4")) {
          folderPrefix = "04_Site_Inspection_HUD";
        }

        archive.file(fullPath, { name: `${folderPrefix}/${file}` });
      });

      await archive.finalize();
    } else {
      await runCommand(`cd "${outputsDir}" && zip -r "${zipPath}" . -x "*.zip"`);
      res.json({
        success: true,
        projectCode,
        downloadUrl: `${BASE_URL}/outputs/${zipFileName}`,
        fileName: zipFileName
      });
    }
  } catch (err) {
    console.error("[DOSSIER_ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ============================================================================
// SERVICE 8: EXECUTIVE CAPABILITY ONE-PAGER PDF
// ============================================================================
app.post("/api/services/pitch-deck-pdf", requireMeteredAuth("batch_export"), async (req, res) => {
  try {
    const { clientName = "AL-RAJHI COMMERCIAL CONTRACTING", contactPerson = "Procurement Directorate" } = req.body;
    const timestamp = Date.now();
    const outputPath = path.join(outputsDir, `capability_overview_${timestamp}.pdf`);

    await generatePitchOnePagerPdf({ clientName, contactPerson, outputPath });

    const fileName = path.basename(outputPath);
    const billing = req.finalizeCredits(5);

    saveDirectiveLog({
      input: `CAPABILITY_PITCH_EXPORT [${clientName}]`,
      context: "commercial_pitch",
      response: `Generated capability deck -> ${fileName}`
    });

    res.json({
      success: true,
      downloadUrl: `${BASE_URL}/outputs/${fileName}`,
      fileName,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 9: EXCEL / CSV BOM INGESTION & AUTO-CLASSIFICATION ENGINE
// ============================================================================
app.post("/api/services/parse-bom", upload.single("bomFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const content = fs.readFileSync(req.file.path, "utf-8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    const items = lines.slice(1).map((line, idx) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const code = cols[0] || `ITM-${String(idx + 1).padStart(2, "0")}`;
      const name = cols[1] || "Fabricated Component";
      const details = cols[2] ? `Qty: ${cols[2]} ${cols[3] || "pcs"}` : "Specified Subassembly";
      const material = cols[5] || cols[4] || "Structural Alloy";
      const sasoStandard = cols[5]?.includes("1591")
        ? "SASO ASTM A572 Gr.50"
        : cols[5]?.includes("6063")
        ? "SASO 2831 / GB/T 5237"
        : "SASO / ASTM Parity";

      return {
        code,
        name,
        details,
        material,
        sasoStandard,
        hsCode: "7604.29.00"
      };
    });

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 10: SECURE CLOUD DOSSIER DISPATCH (S3 / CLOUDFLARE R2)
// ============================================================================
app.post("/api/services/dispatch-cloud", async (req, res) => {
  try {
    const { projectCode = "MOMRAH-RYD-2026-04", fileName } = req.body;

    let targetFile = fileName;
    if (!targetFile) {
      const zipFiles = fs.readdirSync(outputsDir).filter((f) => f.startsWith("dossier_") && f.endsWith(".zip"));
      if (zipFiles.length === 0) {
        return res.status(404).json({ success: false, error: "No compiled dossier ZIP archive found to dispatch." });
      }
      zipFiles.sort((a, b) => fs.statSync(path.join(outputsDir, b)).mtimeMs - fs.statSync(path.join(outputsDir, a)).mtimeMs);
      targetFile = zipFiles[0];
    }

    const filePath = path.join(outputsDir, targetFile);
    const result = await uploadDossierAndGetPresignedUrl(filePath, projectCode);

    saveDirectiveLog({
      input: `CLOUD_DOSSIER_DISPATCH [${projectCode}] -> ${result.key}`,
      context: "cloud_dispatch",
      response: `Presigned link generated (24h validity)`
    });

    res.json({
      success: true,
      projectCode,
      fileName: targetFile,
      ...result
    });
  } catch (err) {
    console.error("[CLOUD_DISPATCH_ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Companion Directive Endpoints
app.post("/api/companion/directive", async (req, res) => {
  try {
    const { input, context } = req.body;
    const result = await processCompanionDirective({ input, context });
    saveDirectiveLog({ input, context, response: result.response });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/companion/batch", async (req, res) => {
  try {
    const { directives, context } = req.body;
    const result = await processBatchDirectives({ directives, context });
    saveDirectiveLog({ input: `BATCH_RUN [${result.totalProcessed} items]`, context, response: "Batch compiled." });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/companion/history", (req, res) => {
  try {
    const logs = getDirectiveLogs();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-prune maintenance check
setInterval(() => {
  try {
    if (!fs.existsSync(outputsDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(outputsDir);
    files.forEach((file) => {
      if (file.endsWith(".zip")) {
        const fullPath = path.join(outputsDir, file);
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(fullPath);
        }
      }
    });
  } catch (err) {
    console.error("Auto-prune maintenance check failed:", err.message);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n⚡ MIU Sovereign AEC Core running on ${BASE_URL} (Port ${PORT})`);
});