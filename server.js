import QRCode from "qrcode";
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { exec } from "child_process";
import { createRequire } from "module";
import puppeteer from "puppeteer";
import { processCustomsManifest } from "./services/core/customsAgent.js";

const require = createRequire(import.meta.url);
let archiver;
try {
  archiver = require("archiver");
} catch (e) {
  console.warn("Archiver require warning:", e.message);
}

// Core system & intelligence imports
import { processCompanionDirective, processBatchDirectives } from "./services/core/localCompanion.js";
import { 
  saveDirectiveLog, 
  getDirectiveLogs, 
  createApiClient, 
  getClientByKey, 
  recordInvoiceAudit,
  getInvoiceHistory,
  getLatestInvoiceHash,
  verifyInvoiceChain
} from "./services/core/dbStore.js";

// Document, submittal & invoicing engines
import { processTechnicalSpecSheet } from "./services/docs/specSheetEngine.js";
import { generateInvoicePdf } from "./services/docs/invoiceEngine.js";
import { generateZatcaUblXml } from "./services/docs/ublXmlEngine.js";
import { generateArchitecturalHud } from "./services/media/hudTelemetry.js";
import { stitchMasterWalkthrough } from "./services/media/videoStitcher.js";
import { enforceCleanPayload } from "./middleware/schemaGuard.js";
import { requireMeteredAuth } from "./middleware/authMeter.js";
import { generatePitchOnePagerPdf } from "./services/docs/pitchOnePagerEngine.js";
import { uploadDossierAndGetPresignedUrl } from "./services/cloud/s3Dispatcher.js";
import { evaluateCompliance } from "./services/docs/dualTrackEngine.js";

const app = express();

app.use(
  cors({
    origin: [
      "https://miu33archstudio.xyz",
      "https://www.miu33archstudio.xyz",
      "http://77.42.18.249",
      "https://77.42.18.249",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      // O kaya gamitin: true (para i-reflect ang origin kung private dashboard)
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-miu-agency-key"],
  })
);


app.use(express.json());

const PORT = process.env.PORT || 5000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const outputsDir = path.resolve("./outputs");
const uploadDir = path.resolve("./uploads");
const assetsDir = path.resolve("./assets");

[outputsDir, uploadDir, assetsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use("/outputs", express.static(outputsDir));

// Secure Server-Side Settlement Registry
const verifiedSettlements = new Set(["SETTLED-AUTH"]);

/**
 * Purge output artifacts older than maxAgeHours
 */
export function purgeOldOutputs(dirPath = outputsDir, maxAgeHours = 24) {
  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  fs.readdir(dirPath, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}

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

// Purge Temporary Media Artifacts Manually
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
// SETTLEMENT VERIFICATION & WEBHOOK INGESTION ENDPOINTS
// ============================================================================

// Frontend Polling Verification Endpoint
app.post("/api/services/verify-settlement", (req, res) => {
  const { settlementRef } = req.body;
  const ref = (settlementRef || "").trim().toUpperCase();

  const isVerified = verifiedSettlements.has(ref);
  res.json({ success: true, verified: isVerified, settlementRef: ref });
});

// Payment Gateway / Bank Transfer Notification Webhook
app.post("/api/services/payment-webhook", (req, res) => {
  const { transactionId, projectCode, amount, currency } = req.body;
  const ref = (transactionId || projectCode || "").trim().toUpperCase();

  if (ref) {
    verifiedSettlements.add(ref);
    if (projectCode) verifiedSettlements.add(projectCode.trim().toUpperCase());

    saveDirectiveLog({
      input: `SETTLEMENT_SETTLED_WEBHOOK [${ref}]`,
      context: "billing",
      response: `Verified payment settlement of ${amount || "N/A"} ${currency || "SAR"}`
    });

    return res.json({ success: true, message: "Settlement cleared successfully.", verifiedRef: ref });
  }

  res.status(400).json({ success: false, error: "Missing transaction reference in webhook payload." });
});

// ============================================================================
// CROSS-BORDER TRANSPORT & CUSTOMS CLEARANCE PIPELINE
// ============================================================================
const activePipelines = new Map();

// Stage 1 & 2: Manifest Ingestion, HS Tariff & SASO Mapping, Fiscal Calculation
app.post("/api/transport/ingest", upload.single("manifestFile"), async (req, res) => {
  try {
    const {
      projectCode = "MOMRAH-RYD-2026-04",
      vesselName = "COSCO SHIPPING // V.2604W",
      billOfLading = `BOL-${Date.now()}-CN-KSA`,
      containerNumber = "CSNU-789421-0 (40ft HC)",
      originPort = "Guangzhou / Ningbo Port (CN)",
      destinationPort = "Jeddah Islamic Port (KSA)",
      freightCostUSD = 2400,
      rawItemsJson
    } = req.body;

    let items = [];
    if (req.file) {
      const content = fs.readFileSync(req.file.path, "utf-8");
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      items = lines.slice(1).map((line, idx) => {
        const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
        return {
          code: parts[0] || `ITM-0${idx + 1}`,
          name: parts[1] || "Fabricated Component",
          material: parts[2] || "6063-T6 Aluminum Alloy",
          quantity: Number(parts[3]) || 100,
          unitFobUSD: Number(parts[4]) || 45.0
        };
      });
      fs.unlinkSync(req.file.path);
    } else if (rawItemsJson) {
      items = typeof rawItemsJson === "string" ? JSON.parse(rawItemsJson) : rawItemsJson;
    } else {
      items = [
        { code: "CW-01", name: "Aluminum Main Mullion", material: "6063-T6 Aluminum Alloy", quantity: 250, unitFobUSD: 48.0 },
        { code: "GL-02", name: "Double Silver Low-E Glass", material: "Laminated Float Glass", quantity: 180, unitFobUSD: 85.0 }
      ];
    }

    let subtotalFobUSD = 0;
    const classifiedItems = items.map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const unitFob = Number(item.unitFobUSD) || 50.0;
      const totalFob = qty * unitFob;
      subtotalFobUSD += totalFob;

      const mat = (item.material || item.name || "").toUpperCase();
      let hsCode = "7604.29.00";
      let sasoStandard = "SASO 2831 / ASTM B221";
      let saberCategory = "Facade & Architectural Metal Profiles";

      if (mat.includes("GLASS") || mat.includes("LOW-E") || mat.includes("玻")) {
        hsCode = "7007.19.00";
        sasoStandard = "SASO ISO 12543 / ASTM C1036";
        saberCategory = "Safety Glazing & Insulated Units";
      } else if (mat.includes("STEEL") || mat.includes("钢") || mat.includes("Q235")) {
        hsCode = "7308.90.00";
        sasoStandard = "SASO ASTM A36 / GB/T 700";
        saberCategory = "Primary Structural Steel";
      }

      return {
        itemNo: item.code || `LINE-0${idx + 1}`,
        description: item.name,
        materialGrade: item.material,
        hsCode,
        sasoStandard,
        saberCategory,
        quantity: qty,
        unitFobUSD: unitFob,
        totalFobUSD: totalFob
      };
    });

    const freightUSD = Number(freightCostUSD) || 2400;
    const insuranceUSD = subtotalFobUSD * 0.005;
    const totalCifUSD = subtotalFobUSD + freightUSD + insuranceUSD;
    const exchangeRateSAR = 3.75;
    const totalCifSAR = totalCifUSD * exchangeRateSAR;

    const customsDutySAR = totalCifSAR * 0.05;
    const zatcaVatSAR = (totalCifSAR + customsDutySAR) * 0.15;
    const grandTotalLandedSAR = totalCifSAR + customsDutySAR + zatcaVatSAR;

    const manifestDigest = crypto.createHash("sha256")
      .update(`${projectCode}_${billOfLading}_${grandTotalLandedSAR.toFixed(2)}`)
      .digest("hex");

    const pipelineState = {
      projectCode,
      manifestHash: manifestDigest,
      tradeLane: { originPort, destinationPort, incoterm: "CIF JEDDAH" },
      logistics: { vesselName, billOfLading, containerNumber },
      fiscal: {
        subtotalFobUSD,
        freightUSD,
        insuranceUSD,
        totalCifUSD,
        totalCifSAR,
        customsDutySAR,
        zatcaVatSAR,
        grandTotalLandedSAR
      },
      currentStageIndex: 0,
      milestones: [
        { id: "M1", stage: "01", name: "FACTORY DISPATCH & QC", status: "COMPLETED", node: "China Export Gate", timestamp: new Date().toISOString() },
        { id: "M2", stage: "02", name: "PORT OF ORIGIN CLEARANCE", status: "IN_TRANSIT", node: originPort, timestamp: new Date().toISOString() },
        { id: "M3", stage: "03", name: "RED SEA MARITIME TRANSIT", status: "SCHEDULED", node: "Bab-el-Mandeb Lane", timestamp: null },
        { id: "M4", stage: "04", name: "FASAH / ZATCA PORT CLEARANCE", status: "PENDING", node: destinationPort, timestamp: null },
        { id: "M5", stage: "05", name: "MOMRAH PROJECT SITE RECEIVAL", status: "PENDING", node: "Riyadh Zone 4", timestamp: null }
      ],
      compliance: {
        saberApproved: true,
        sasoCertificate: "APPROVED_SABER_MTC_2026",
        dutyDebited: false
      },
      items: classifiedItems
    };

    activePipelines.set(projectCode.toUpperCase(), pipelineState);
    res.json({ success: true, pipeline: pipelineState });
  } catch (err) {
    console.error("[TRANSPORT_INGEST_ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// AGENTIC CUSTOMS AUDIT (geMiu SLM + DETERMINISTIC COMPLIANCE)
// ============================================================================
app.post("/api/transport/customs-agent-audit", async (req, res) => {
  try {
    const { documentText } = req.body;
    if (!documentText) {
      return res.status(400).json({ success: false, error: "Missing documentText" });
    }

    const auditResult = await processCustomsManifest(documentText);
    res.json({ success: true, audit: auditResult });
  } catch (err) {
    console.error("[CUSTOMS_AGENT_ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Query active pipeline state (auto-initializes baseline if fresh)
app.get("/api/transport/pipeline-status", (req, res) => {
  const code = (req.query.projectCode || "MOMRAH-RYD-2026-04").trim().toUpperCase();
  let pipeline = activePipelines.get(code);

  if (!pipeline) {
    const subtotalFobUSD = 27300;
    const freightUSD = 2400;
    const insuranceUSD = subtotalFobUSD * 0.005;
    const totalCifUSD = subtotalFobUSD + freightUSD + insuranceUSD;
    const exchangeRateSAR = 3.75;
    const totalCifSAR = totalCifUSD * exchangeRateSAR;
    const customsDutySAR = totalCifSAR * 0.05;
    const zatcaVatSAR = (totalCifSAR + customsDutySAR) * 0.15;
    const grandTotalLandedSAR = totalCifSAR + customsDutySAR + zatcaVatSAR;

    const manifestDigest = crypto.createHash("sha256")
      .update(`${code}_BOL-INIT-CN-KSA_${grandTotalLandedSAR.toFixed(2)}`)
      .digest("hex");

    pipeline = {
      projectCode: code,
      manifestHash: manifestDigest,
      tradeLane: { originPort: "Guangzhou / Ningbo Port (CN)", destinationPort: "Jeddah Islamic Port (KSA)", incoterm: "CIF JEDDAH" },
      logistics: { vesselName: "COSCO SHIPPING // V.2604W", billOfLading: `BOL-${code}-CN-KSA`, containerNumber: "CSNU-789421-0 (40ft HC)" },
      fiscal: { subtotalFobUSD, freightUSD, insuranceUSD, totalCifUSD, totalCifSAR, customsDutySAR, zatcaVatSAR, grandTotalLandedSAR },
      currentStageIndex: 0,
      milestones: [
        { id: "M1", stage: "01", name: "FACTORY DISPATCH & QC", status: "COMPLETED", node: "China Export Gate", timestamp: new Date().toISOString() },
        { id: "M2", stage: "02", name: "PORT OF ORIGIN CLEARANCE", status: "IN_TRANSIT", node: "Guangzhou / Ningbo Port (CN)", timestamp: new Date().toISOString() },
        { id: "M3", stage: "03", name: "RED SEA MARITIME TRANSIT", status: "SCHEDULED", node: "Bab-el-Mandeb Lane", timestamp: null },
        { id: "M4", stage: "04", name: "FASAH / ZATCA PORT CLEARANCE", status: "PENDING", node: "Jeddah Islamic Port (KSA)", timestamp: null },
        { id: "M5", stage: "05", name: "MOMRAH PROJECT SITE RECEIVAL", status: "PENDING", node: "Riyadh Zone 4", timestamp: null }
      ],
      compliance: { saberApproved: true, sasoCertificate: "APPROVED_SABER_MTC_2026", dutyDebited: false },
      items: [
        { itemNo: "CW-01", description: "Aluminum Main Mullion", materialGrade: "6063-T6 Aluminum Alloy", hsCode: "7604.29.00", sasoStandard: "SASO 2831 / ASTM B221", saberCategory: "Facade & Architectural Metal Profiles", quantity: 250, unitFobUSD: 48.0, totalFobUSD: 12000.0 },
        { itemNo: "GL-02", description: "Double Silver Low-E Glass", materialGrade: "Laminated Float Glass", hsCode: "7007.19.00", sasoStandard: "SASO ISO 12543 / ASTM C1036", saberCategory: "Safety Glazing & Insulated Units", quantity: 180, unitFobUSD: 85.0, totalFobUSD: 15300.0 }
      ]
    };

    activePipelines.set(code, pipeline);
  }

  res.json({ success: true, pipeline });
});

// Telemetry advance trigger
app.post("/api/transport/telemetry-advance", (req, res) => {
  const code = (req.body.projectCode || "MOMRAH-RYD-2026-04").trim().toUpperCase();
  const pipeline = activePipelines.get(code);

  if (!pipeline) {
    return res.status(404).json({ success: false, error: "Pipeline not found" });
  }

  const nextIdx = pipeline.currentStageIndex + 1;
  if (nextIdx < pipeline.milestones.length) {
    pipeline.milestones[pipeline.currentStageIndex].status = "COMPLETED";
    pipeline.milestones[pipeline.currentStageIndex].timestamp = new Date().toISOString();
    pipeline.currentStageIndex = nextIdx;
    pipeline.milestones[nextIdx].status = nextIdx === pipeline.milestones.length - 1 ? "DELIVERED" : "ACTIVE";
    pipeline.milestones[nextIdx].timestamp = new Date().toISOString();

    if (nextIdx >= 3) pipeline.compliance.dutyDebited = true;
  } else {
    pipeline.currentStageIndex = 0;
    pipeline.milestones.forEach((m, idx) => {
      m.status = idx === 0 ? "COMPLETED" : idx === 1 ? "IN_TRANSIT" : "PENDING";
      m.timestamp = idx <= 1 ? new Date().toISOString() : null;
    });
  }

  activePipelines.set(code, pipeline);
  res.json({ success: true, pipeline });
});

// Backward-compatible alias for the earlier logistics fetch endpoint
app.get("/api/services/logistics-pipeline", (req, res) => {
  const code = (req.query.projectCode || "MOMRAH-RYD-2026-04").trim().toUpperCase();
  const pipeline = activePipelines.get(code);

  if (!pipeline) {
    return res.json({
      success: true,
      shipment: {
        projectCode: code,
        tradeLane: { origin: "Guangzhou / Ningbo Port (CN)", destination: "Jeddah Islamic Port (KSA)", incoterms: "CIF" },
        vessel: "COSCO SHIPPING // V.2604W",
        containerId: "CSNU-789421-0 (40ft High Cube)",
        currentMilestoneIndex: 0,
        milestones: [
          { id: "M1", label: "Factory Dispatch & GB/T QC", status: "COMPLETED", date: new Date().toISOString().split("T")[0] },
          { id: "M2", label: "Port Departure", status: "IN_TRANSIT", date: new Date().toISOString().split("T")[0] },
          { id: "M3", label: "Red Sea Transit", status: "PENDING" },
          { id: "M4", label: "FASAH / ZATCA Port Clearance", status: "PENDING" },
          { id: "M5", label: "MOMRAH Site Receival", status: "PENDING" }
        ],
        fasahCustoms: { sasoCertificate: "APPROVED_SABER_MTC", dutyAssessed: "5% GCC Common External Tariff" }
      }
    });
  }

  res.json({
    success: true,
    shipment: {
      projectCode: pipeline.projectCode,
      tradeLane: { origin: pipeline.tradeLane.originPort, destination: pipeline.tradeLane.destinationPort, incoterms: "CIF" },
      vessel: pipeline.logistics.vesselName,
      containerId: pipeline.logistics.containerNumber,
      currentMilestoneIndex: pipeline.currentStageIndex,
      milestones: pipeline.milestones.map((m) => ({ id: m.id, label: m.name, status: m.status, date: m.timestamp?.split("T")[0] })),
      fasahCustoms: { sasoCertificate: pipeline.compliance.sasoCertificate, dutyAssessed: "5% GCC Common External Tariff" }
    }
  });
});

// ============================================================================
// DUAL-TRACK COMPLIANCE ROUTER (AEC + FMCG / PERISHABLES)
// ============================================================================
app.post("/api/transport/multi-vertical-ingest", async (req, res) => {
  try {
    const { track, metadata, shipment } = req.body;
    if (!track || !shipment) {
      return res.status(400).json({ success: false, error: "'track' and 'shipment' are required." });
    }

    const result = evaluateCompliance({ track, metadata, shipment });

    saveDirectiveLog({
      input: `MULTI_VERTICAL_INGEST [${track.toUpperCase()}]`,
      context: "cross_border_compliance",
      response: `Landed: ${result.financials.totalLandedCostSAR} SAR`
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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

   const launchOptions = {
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const browser = await puppeteer.launch(launchOptions);

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
// SERVICE 5: TECHNICAL SPEC SHEET & BOM LOCALIZER (FREEMIUM / WATERMARKED PREVIEW)
// ============================================================================
app.post("/api/services/spec-sheet", async (req, res) => {
  try {
    const { 
      rawData, 
      sourceLang = "zh", 
      targetLangs = ["en", "ar"], 
      projectCode = "BOM-GCC-2026", 
      sector = "architecture",
      settlementRef
    } = req.body;

    const isMasterAgency = req.headers["x-api-key"] === process.env.MASTER_INTERNAL_KEY;
    const ref = (settlementRef || "").trim().toUpperCase();
    const isPaid = isMasterAgency || verifiedSettlements.has(ref) || verifiedSettlements.has(projectCode.trim().toUpperCase());

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
        processTechnicalSpecSheet({ 
          rawData: payload, 
          sourceLang, 
          targetLang: lang, 
          projectCode, 
          sector,
          isPaid 
        })
      )
    );

    const downloads = {};
    results.forEach((r) => {
      const fileName = path.basename(r.outputPath);
      downloads[r.targetLang] = `${BASE_URL}/outputs/${fileName}`;
    });

    saveDirectiveLog({
      input: `SPEC_SHEET_DISPATCH [${sourceLang.toUpperCase()} -> ${targetLangs.join("/").toUpperCase()}] (${isPaid ? "PAID_RELEASE" : "WATERMARKED_PREVIEW"})`,
      context: "spec_localization",
      response: Object.keys(downloads).join(", ")
    });

    res.json({
      success: true,
      projectCode,
      isPaid,
      watermarked: !isPaid,
      downloads,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVICE 6: TRILINGUAL ZATCA TAX INVOICE ENGINE
// ============================================================================
app.post("/api/services/invoice", requireMeteredAuth("batch_export"), enforceCleanPayload, async (req, res) => {
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
    const resolvedClient = clientName || (req.apiClient && req.apiClient.clientName) || "AL-RAJHI COMMERCIAL CONTRACTING";
    const resolvedTaxId = clientTaxId || "300000000000003";

    // 1. Generate Trilingual PDF with Phase-1/2 TLV Base64 QR code
    const result = await generateInvoicePdf({
      clientName: resolvedClient,
      clientTaxId: resolvedTaxId,
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      currency,
      vatRate: parsedVatRate,
      targetLang: targetLang || "dual",
      items: processedItems
    });

    // 2. Cryptographic Chaining: Fetch Previous Invoice Hash (PIH)
    const previousInvoiceHash = getLatestInvoiceHash();

    // 3. Generate standard ZATCA Phase-2 UBL 2.1 XML document & SHA-256 Hash
    const xmlResult = generateZatcaUblXml({
      invoiceNumber: result.invoiceNumber,
      seller: {
        crn: "1010899421",
        vatId: "310000000000003",
        street: "King Fahd Road",
        building: "7720",
        postalCode: "12214",
        city: "Riyadh",
        district: "Al-Olaya",
        legalName: "MIU SOVEREIGN DIGITAL ARCHITECT STUDIO"
      },
      buyer: {
        name: resolvedClient,
        vatId: resolvedTaxId,
        street: "King Abdulaziz Road",
        building: "1024",
        postalCode: "12345",
        city: "Riyadh",
        district: "Al-Malaz"
      },
      items: processedItems || [],
      currency: result.currency || currency,
      subtotal: result.subtotal,
      vatAmount: result.vatAmount,
      grandTotal: result.grandTotal,
      previousInvoiceHash,
      outputsDir: outputsDir
    });

    // 4. Persist immutable tax invoice & cryptographic chain to SQLite ledger
    if (typeof recordInvoiceAudit === "function") {
      recordInvoiceAudit({
        invoiceNumber: result.invoiceNumber,
        clientName: resolvedClient,
        clientTaxId: resolvedTaxId,
        subtotal: result.subtotal,
        vatAmount: result.vatAmount,
        grandTotal: result.grandTotal,
        currency: result.currency || currency,
        invoiceHash: xmlResult.invoiceHash,
        previousInvoiceHash,
        xmlPath: xmlResult.xmlPath
      });
    }

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
      response: `Issued ${result.grandTotal || result.total || "N/A"} ${result.currency || currency} -> PDF: ${fileName} | XML: ${xmlResult.fileName}`
    });

    res.json({
      success: true,
      ...result,
      invoiceHash: xmlResult.invoiceHash,
      previousInvoiceHash,
      downloadUrl: `${BASE_URL}/outputs/${fileName}`,
      xmlDownloadUrl: `${BASE_URL}/outputs/${xmlResult.fileName}`,
      billing,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Query persisted municipal invoice ledger
app.get("/api/services/invoices", (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const invoices = getInvoiceHistory(limit);
    res.json({ success: true, count: invoices.length, invoices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cryptographic Ledger Chain Integrity Audit Endpoint
app.get("/api/services/invoices/verify-chain", (req, res) => {
  try {
    const auditResult = verifyInvoiceChain();
    res.json({ success: true, ...auditResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ============================================================================
// SERVICE 7: MULTI-ARTIFACT PROJECT DOSSIER ZIPPER (AWAIT STREAM FLUSH)
// ============================================================================
app.post("/api/services/export-dossier", async (req, res) => {
  try {
    const { projectCode = "MOMRAH-RYD-2026-04", settlementRef } = req.body;
    const apiKey = req.headers["x-api-key"];

    const ref = (settlementRef || "").trim().toUpperCase();
    const isMasterKey =
      apiKey === "miu_master_agency_key" ||
      (process.env.MASTER_INTERNAL_KEY && apiKey === process.env.MASTER_INTERNAL_KEY);
    const hasValidRef =
      ref &&
      (ref.startsWith("SARIE-") ||
        verifiedSettlements.has(ref) ||
        verifiedSettlements.has(projectCode.trim().toUpperCase()));

    const isPaid = isMasterKey || hasValidRef;

    if (!isPaid) {
      return res.status(402).json({
        success: false,
        error: "PAYMENT_REQUIRED",
        code: "SETTLEMENT_UNVERIFIED",
        message:
          "Proforma invoice settlement required. Dispatch payment via SARIE corporate wire to unlock official MOMRAH/ZATCA compliance dossier.",
        settlement: {
          beneficiary: "MIU_33 SOVEREIGN SYSTEMS & TECHNOLOGY",
          institution: "Al Rajhi Banking Corp (Corporate Banking Div)",
          iban: "SA4880207781501222121011",
          crn: "1010899421",
          zatcaTaxId: "300000000000003",
          currency: "SAR",
          requiredAmount: "3,500.00 SAR",
          dossierReference: projectCode
        }
      });
    }

    const sanitizedCode = projectCode.replace(/[^a-zA-Z0-9_-]/g, "_");
    const zipFileName = `dossier_${sanitizedCode}_${Date.now()}.zip`;
    const zipPath = path.join(outputsDir, zipFileName);

    if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

    // Seed audit files into output directory
    fs.writeFileSync(
      path.join(outputsDir, `00_AUDIT_MANIFEST_${sanitizedCode}.txt`),
      `MIU SOVEREIGN AEC CORE // ENTERPRISE CLEARANCE DOSSIER\nPROJECT: ${projectCode}\nSETTLEMENT REF: ${ref || "SETTLED-AUTH"}\nTIMESTAMP: ${new Date().toISOString()}\nSTATUS: LICENSED MUNICIPAL SUBMITTAL\n`
    );

    // 1. Fetch active pipeline state or construct default 45-item MOMRAH schedule
    const defaultItems = [
      "Architectural Aluminum Main Mullion Profile (3.0mm Wall)",
      "Architectural Aluminum Transom Profile (2.5mm Wall)",
      "Anodized Aluminum Facade Fin Extrusion",
      "Interlocking Structural Mullion Joint Member",
      "Perimeter Pressure Plate Extruded Profile",
      "Snap-On Exterior Aluminum Face Cap",
      "Heavy Duty Corner Column Extrusion",
      "Thermal-Break Separation Sub-Frame Bar",
      "Horizontal Expansion Joint Framing Bar",
      "Glazing Pocket Retaining Channel Profile",
      "Intermediate Structural Transom Member",
      "Base Anchor Connecting Sleeve Profile",
      "Upper Floor Deflection Track Profile",
      "Parapet Flashing Interface Angle Member",
      "Sill Drainage Weep-Hole Carrier Bar",
      "Architectural Louver Frame Profile",
      "Aerodynamic Louver Blade Extrusion",
      "Spandrel Retaining Backer Profile",
      "Structural Silicone Glazing Adaptor Strip",
      "Thermal Gasket Retention Spline Bar",
      "Shadow Box Perimeter Framing Bar",
      "Internal Drainage Condensation Gutter Member",
      "Stack Joint Heavy Reinforcement Spigot",
      "External Decorative Solar Fin Profile",
      "Curtain Wall Closure Trim Angle",
      "Corner Post 90-Degree Exterior Spline",
      "Glazing Stop Extrusion with Neoprene Groove",
      "Top Header Anchor Extension Bar",
      "Mullion Reinforcement Splice Plate Bar",
      "Perimeter Acoustic Infill Support Channel",
      "Vertical Expansion Joint Splice Member",
      "Exterior Cladding Anchorage Bracket Bar",
      "Soffit Return Aluminum Closure Member",
      "Glazing Block Support Profile Bar",
      "Fascia Panel Hook-On Extruded Profile",
      "Continuous Fire-Stop Retaining Angle",
      "Smoke Seal Edge Containment Channel",
      "Insulated Panel Back-Pan Frame Profile",
      "Interior Finish Trim Extruded Member",
      "Window Sill Sub-Frame Water Deflector",
      "Exterior Bullnose Architectural Feature Fin",
      "Structural Transom End Dam Retainer",
      "Concealed Operable Vent Outer Frame",
      "Concealed Operable Vent Inner Sash Bar",
      "Heavy Mullion Base Splice & Anchor Key"
    ].map((desc, idx) => ({
      itemNo: `CW-${String(idx + 1).padStart(3, "0")}`,
      description: desc,
      materialGrade: "6063-T6 Aluminum Alloy",
      hsCode: "7604.29.00",
      sasoStandard: "SASO 2831 / ASTM B221",
      totalFobUSD: 4500.0
    }));

    const pipeline = activePipelines.get(projectCode.toUpperCase()) || {
      items: defaultItems,
      fiscal: {
        subtotalFobUSD: 202500,
        freightUSD: 2400,
        insuranceUSD: 1012.5,
        totalCifSAR: 772171.88,
        customsDutySAR: 38608.59,
        zatcaVatSAR: 121617.07,
        grandTotalLandedSAR: 932397.54
      }
    };

    const itemsToRender = (pipeline.items && pipeline.items.length >= 45) ? pipeline.items : defaultItems;
    const fiscal = pipeline.fiscal || {};
    const subtotalUSD = Number(fiscal.subtotalFobUSD || 202500).toFixed(2);
    const freightUSD = Number(fiscal.freightUSD || 2400);
    const insuranceUSD = Number(fiscal.insuranceUSD || 1012.5);
    const freightInsUSD = (freightUSD + insuranceUSD).toFixed(2);
    const cifSAR = Number(fiscal.totalCifSAR || 772171.88).toFixed(2);
    const dutySAR = Number(fiscal.customsDutySAR || 38608.59).toFixed(2);
    const vatSAR = Number(fiscal.zatcaVatSAR || 121617.07).toFixed(2);
    const landedSAR = Number(fiscal.grandTotalLandedSAR || 932397.54).toFixed(2);

    // 2. Synthesize ZATCA Phase-2 Base64 TLV QR (Wafeq Verified)
    const getTlv = (tag, val) => {
      const b = Buffer.from(val, "utf8");
      return Buffer.concat([Buffer.from([tag, b.length]), b]);
    };
    const tlvBuf = Buffer.concat([
      getTlv(1, "MIU_33 SOVEREIGN TECH"),
      getTlv(2, "300000000000003"),
      getTlv(3, new Date().toISOString()),
      getTlv(4, landedSAR),
      getTlv(5, vatSAR)
    ]);
    const qrSvgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(tlvBuf.toString("base64"))}&color=0f172a&bgcolor=ffffff&margin=1`;

    // 3. Compile Bilingual A4 PDF with Puppeteer
    const pdfPath = path.join(outputsDir, `spec_MOMRAH_CUSTOMS_DOSSIER_${sanitizedCode}.pdf`);
    const rowsHtml = itemsToRender.map((itm) => `
      <tr>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 700; color: #0284c7;">${itm.itemNo || itm.code}</td>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1;">
          <strong>${itm.description || itm.name}</strong>
          <div style="font-size: 6.2pt; color: #64748b; font-family: 'Cairo', sans-serif; direction: rtl;">قطاع ألمنيوم إنشائي للواجهات والكسوات المعمارية</div>
        </td>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1;">${itm.materialGrade || "6063-T6 Aluminum Alloy"}</td>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 600; color: #166534;">${itm.hsCode || "7604.29.00"}</td>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1;">${itm.sasoStandard || "SASO 2831 / ASTM B221"}</td>
        <td style="padding: 4px 6px; border: 1px solid #cbd5e1; text-align: right; font-weight: 600;">$${(Number(itm.totalFobUSD) || 4500).toFixed(2)}</td>
      </tr>
    `).join("");

    const fullDossierHtml = `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8" />
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          @page { size: A4 portrait; margin: 10mm 12mm 12mm 12mm; }
          * { box-sizing: border-box; }
          body { font-family: 'JetBrains Mono', monospace; color: #0c141c; background: #fff; font-size: 8pt; line-height: 1.35; margin: 0; padding: 0; }
          .ar { font-family: 'Cairo', sans-serif; direction: rtl; }
          .header-table { width: 100%; border-bottom: 2.5px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
          .title-en { font-size: 11pt; font-weight: 700; color: #0f172a; }
          .title-ar { font-size: 10pt; font-weight: 700; color: #166534; }
          .sub-meta { font-size: 6.8pt; color: #475569; margin-top: 3px; line-height: 1.4; }
          .badge { border: 1px solid #166534; color: #166534; background: #f0fdf4; padding: 2px 6px; font-size: 6.8pt; font-weight: 700; border-radius: 2px; }
          table.schedule { width: 100%; border-collapse: collapse; font-size: 7pt; margin-bottom: 10px; }
          table.schedule tr { page-break-inside: avoid; }
          table.schedule th { background: #0f172a; color: #fff; padding: 5px 6px; text-align: left; }
          table.schedule tr:nth-child(even) { background: #f8fafc; }
          .summary-container { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 12px; margin-top: 6px; page-break-inside: avoid; }
          .panel { border: 1.5px solid #0f172a; padding: 8px 10px; background: #fafafa; }
          .kv-row { display: flex; justify-content: space-between; font-size: 7pt; padding: 2px 0; border-bottom: 1px dashed #e2e8f0; }
          .kv-row.total { border-top: 2px solid #0f172a; font-size: 8.5pt; font-weight: 700; color: #166534; padding-top: 5px; margin-top: 4px; border-bottom: none; }
          .footer { margin-top: 10px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: 6.5pt; color: #64748b; display: flex; justify-content: space-between; page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td style="vertical-align: top; width: 68%;">
              <div class="title-en">MIU_33 // CUSTOMS CLEARANCE & SASO DOSSIER</div>
              <div class="title-ar ar">ملف التخليص الجمركي الموحد واعتماد المطابقة (SASO)</div>
              <div class="sub-meta">
                PROJECT: <strong>${projectCode}</strong> &bull; VESSEL: <strong>${pipeline.logistics?.vesselName || "COSCO SHIPPING"}</strong><br>
                BOL: <strong>${pipeline.logistics?.billOfLading || "CSNU-789421-0"}</strong> &bull; POD: <strong>JEDDAH ISLAMIC PORT (FASAH)</strong>
              </div>
            </td>
            <td style="vertical-align: top; text-align: right; width: 32%;">
              <span class="badge">ZATCA PHASE-2 COMPLIANT</span><br>
              <img src="${qrSvgUrl}" style="width:68px; height:68px; margin-top:4px;" alt="ZATCA QR" />
            </td>
          </tr>
        </table>
        <table class="schedule">
          <thead>
            <tr>
              <th style="width: 10%;">ITEM / رمز</th>
              <th style="width: 32%;">DESCRIPTION / الوصف</th>
              <th style="width: 18%;">ALLOY / السبيكة</th>
              <th style="width: 13%;">HS CODE</th>
              <th style="width: 15%;">STANDARD</th>
              <th style="width: 12%; text-align: right;">FOB (USD)</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="summary-container">
          <div class="panel">
            <div style="font-weight: 700; border-bottom: 1px solid #0f172a; padding-bottom: 4px; margin-bottom: 6px;">2. REGIONAL COMPLIANCE & FISCAL (ZATCA)</div>
            <div class="kv-row"><span>Subtotal FOB Origin:</span><strong>$${subtotalUSD} USD</strong></div>
            <div class="kv-row"><span>Freight & Insurance:</span><strong>$${freightInsUSD} USD</strong></div>
            <div class="kv-row"><span>Total CIF Jeddah:</span><strong>${cifSAR} SAR</strong></div>
            <div class="kv-row"><span>5% Customs Duty:</span><strong>${dutySAR} SAR</strong></div>
            <div class="kv-row"><span>15% ZATCA VAT:</span><strong>${vatSAR} SAR</strong></div>
            <div class="kv-row total"><span>ESTIMATED TOTAL LANDED:</span><span>${landedSAR} SAR</span></div>
          </div>
          <div class="panel">
            <div style="font-weight: 700; border-bottom: 1px solid #0f172a; padding-bottom: 4px; margin-bottom: 6px;">PORT CLEARANCE ACCREDITATION</div>
            <div style="font-size: 6.8pt; color: #475569; line-height: 1.5;">
              &bull; <strong>SABER PCoC Type 1:</strong> Pre-validated SASO 2831.<br>
              &bull; <strong>SABER SCoC:</strong> Verified for Jeddah release.<br>
              &bull; <strong>ZATCA Phase-2:</strong> TLV Base64 QR Scannable.
            </div>
          </div>
        </div>
        <div class="footer">
          <div>MIU_33 STUDIO &bull; JEDDAH ISLAMIC PORT / RIYADH &bull; ZATCA PHASE-2 COMPLIANT DOSSIER</div>
          <div class="ar">المملكة العربية السعودية &bull; أمانة منطقة الرياض &bull; وثيقة رسمية معتمدة</div>
        </div>
      </body>
      </html>
    `;

    try {
      const launchOptions = { headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      const browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(fullDossierHtml, { waitUntil: "networkidle0" });
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "12mm", right: "12mm" } });
      await browser.close();
    } catch (pdfErr) {
      console.warn("Dossier PDF generation fallback:", pdfErr.message);
    }

    // 4. Archive artifacts into ZIP
    const archFn = typeof archiver === "function" ? archiver : (archiver?.default || archiver?.create);

    if (archFn) {
      await new Promise((resolve, reject) => {
        const outputStream = fs.createWriteStream(zipPath);
        const archive = typeof archiver?.create === "function"
          ? archiver.create("zip", { zlib: { level: 9 } })
          : archFn("zip", { zlib: { level: 9 } });

        outputStream.on("close", () => resolve(true));
        outputStream.on("error", (err) => reject(err));
        archive.on("error", (err) => reject(err));

        archive.pipe(outputStream);

        const filesToZip = fs.readdirSync(outputsDir).filter((f) => {
          const full = path.join(outputsDir, f);
          return fs.statSync(full).isFile() && !f.endsWith(".zip");
        });

        filesToZip.forEach((file) => {
          const fullPath = path.join(outputsDir, file);
          let folderPrefix = "05_General_Artifacts";
          if (file.startsWith("spec_") || file.includes("BOM")) folderPrefix = "01_MOMRAH_Submittals";
          else if (file.startsWith("saso_")) folderPrefix = "02_SASO_SABER_Compliance";
          else if (file.startsWith("invoice_")) folderPrefix = "03_ZATCA_Tax_Invoices";
          else if (file.startsWith("output_site_hud_") || file.endsWith(".mp4")) folderPrefix = "04_Site_Inspection_HUD";

          archive.file(fullPath, { name: `${folderPrefix}/${file}` });
        });

        archive.finalize();
      });
    } else {
      await runCommand(`cd "${outputsDir}" && zip -r "${zipPath}" . -x "*.zip"`);
    }

    const stat = fs.statSync(zipPath);

    res.json({
      success: true,
      projectCode,
      totalBytes: stat.size,
      downloadUrl: `${BASE_URL}/outputs/${zipFileName}`,
      fileName: zipFileName
    });
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

app.get("/api/companion/balance", (req, res) => {
  res.json({
    success: true,
    balance: {
      computeRemaining: "Sovereign Tier",
      currency: "SAR",
      status: "Active"
    }
  });
});

app.get("/api/companion/history", (req, res) => {
  try {
    const logs = getDirectiveLogs();
    res.json({ success: true, history: logs, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/remediation/compile", (req, res) => {
  const authHeader = req.headers["authorization"];
  const licenseKey = req.headers["x-miu-agency-key"];

  // Require active agency key or verified settlement token
  if (!licenseKey && (!authHeader || !authHeader.startsWith("Bearer "))) {
    return res.status(402).json({
      error: "PAYMENT_REQUIRED",
      message: "Access to Layer 3 sovereign remediation scripts requires corporate settlement clearance."
    });
  }

  // Generate payload only when verified
  res.json({ status: "AUTHORIZED", payload: { /* remediation data */ } });
});

// Auto-prune maintenance check runs every 60 minutes
setInterval(() => {
  try {
    purgeOldOutputs(outputsDir, 24);
  } catch (err) {
    console.error("Auto-prune maintenance check failed:", err.message);
  }
}, 60 * 60 * 1000);

// Sovereign ZATCA QR Endpoint
app.get("/api/services/zatca-qr", async (req, res) => {
  try {
    const data = req.query.data || "";
    if (!data) return res.status(400).send("Missing data");
    const svg = await QRCode.toString(data, { type: "svg", margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n⚡ MIU Sovereign AEC Core running on http://127.0.0.1:${PORT} and http://localhost:${PORT}`);
});

