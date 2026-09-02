import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve("./sovereign_ledger.db");
const db = new Database(dbPath);

// Enable Write-Ahead Logging for fast concurrent execution
db.pragma("journal_mode = WAL");

// Initialize complete enterprise schema
db.exec(`
  CREATE TABLE IF NOT EXISTS directive_logs (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    context TEXT,
    response TEXT,
    savedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_clients (
    apiKey TEXT PRIMARY KEY,
    clientName TEXT NOT NULL,
    plan TEXT NOT NULL,
    creditsRemaining REAL NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_transactions (
    id TEXT PRIMARY KEY,
    apiKey TEXT NOT NULL,
    serviceType TEXT NOT NULL,
    creditsDeducted REAL NOT NULL,
    durationSeconds REAL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS municipal_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoiceNumber TEXT UNIQUE NOT NULL,
    clientName TEXT NOT NULL,
    clientTaxId TEXT NOT NULL,
    subtotal REAL NOT NULL,
    vatAmount REAL NOT NULL,
    grandTotal REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'SAR',
    createdAt TEXT NOT NULL
  );
`);

// Seed master admin key if missing
const existingMaster = db.prepare("SELECT * FROM api_clients WHERE apiKey = ?").get("miu_master_agency_key");
if (!existingMaster) {
  db.prepare(`
    INSERT INTO api_clients (apiKey, clientName, plan, creditsRemaining, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run("miu_master_agency_key", "MIU Studio Core", "agency_unlimited", 999999, new Date().toISOString());
}

export function saveDirectiveLog(entry) {
  const id = `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const savedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO directive_logs (id, input, context, response, savedAt)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    entry.input || "UNKNOWN_DIRECTIVE",
    entry.context || "general",
    typeof entry.response === "object" ? JSON.stringify(entry.response) : String(entry.response || ""),
    savedAt
  );

  return { id, savedAt };
}

export function getDirectiveLogs(limit = 50) {
  return db.prepare("SELECT * FROM directive_logs ORDER BY rowid DESC LIMIT ?").all(limit);
}

export function getClientByKey(apiKey) {
  return db.prepare("SELECT * FROM api_clients WHERE apiKey = ?").get(apiKey);
}

export function createApiClient({ apiKey, clientName, plan = "starter", initialCredits = 100 }) {
  const key = apiKey || `miu_live_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`
    INSERT INTO api_clients (apiKey, clientName, plan, creditsRemaining, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(key, clientName, plan, initialCredits, new Date().toISOString());
  return { apiKey: key, clientName, plan, creditsRemaining: initialCredits };
}

export function deductClientCredits({ apiKey, serviceType, credits, durationSeconds = 0 }) {
  const client = getClientByKey(apiKey);
  if (!client) throw new Error("Invalid API key.");
  if (client.creditsRemaining < credits) throw new Error("Insufficient credit balance.");

  const newBalance = client.creditsRemaining - credits;

  db.prepare("UPDATE api_clients SET creditsRemaining = ? WHERE apiKey = ?").run(newBalance, apiKey);

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO credit_transactions (id, apiKey, serviceType, creditsDeducted, durationSeconds, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(txId, apiKey, serviceType, credits, durationSeconds, new Date().toISOString());

  return { success: true, remainingBalance: newBalance, deducted: credits };
}

export function recordInvoiceAudit({ invoiceNumber, clientName, clientTaxId, subtotal, vatAmount, grandTotal, currency }) {
  db.prepare(`
    INSERT INTO municipal_invoices (invoiceNumber, clientName, clientTaxId, subtotal, vatAmount, grandTotal, currency, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invoiceNumber,
    clientName,
    clientTaxId,
    Number(subtotal),
    Number(vatAmount),
    Number(grandTotal),
    currency,
    new Date().toISOString()
  );
}

export function getInvoiceHistory(limit = 50) {
  return db.prepare("SELECT * FROM municipal_invoices ORDER BY id DESC LIMIT ?").all(limit);
}