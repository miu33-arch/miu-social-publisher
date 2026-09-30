import crypto from 'crypto';

const USD_TO_SAR = 3.75;
const KSA_VAT_RATE = 0.15;

/**
 * Deterministic Customs Compliance & Landed Cost Engine
 */
export function runCustomsAudit(payload) {
  const flags = [];
  let totalCifUsd = 0;
  let totalDutySar = 0;

  for (const item of payload.line_items) {
    totalCifUsd += Number(item.declared_value_cif_usd || 0);
    const itemCifSar = Number(item.declared_value_cif_usd || 0) * USD_TO_SAR;

    // 1. Mandatory SASO On-Body Permanent Marking Audit
    const marking = String(item.marking_method || '').toUpperCase();
    if (marking === 'PRINTED_STICKER' || marking === 'NONE') {
      flags.push({
        item_id: item.item_id,
        level: 'BLOCKER',
        code: 'ERR_SASO_MARKING_NON_COMPLIANT',
        message: 'KSA customs mandates permanent, non-removable on-body marking (embossed/engraved) for industrial imports. Removable stickers are non-compliant.'
      });
    }

    // 2. Chinese GB/T to GCC SASO/ASTM Equivalency Check
    const spec = String(item.standard_specification || '').toUpperCase();
    const grade = String(item.material_grade || '').toUpperCase();
    if (spec.includes('GB/T 700') && grade.includes('Q235B')) {
      flags.push({
        item_id: item.item_id,
        level: 'WARNING',
        code: 'WARN_STANDARD_EQUIVALENCY_DOCUMENT_REQUIRED',
        message: 'GB/T 700 Q235B maps to ASTM A36 / SASO ASTM A36 equivalent. Dual-language (CN/EN) Mill Test Certificate required for Saber declaration.'
      });
    }

    // 3. Tariff Computation (5% baseline for structural steel / metals)
    const hs = String(item.declared_hs_code || '');
    const dutyRate = (hs.startsWith('72') || hs.startsWith('73')) ? 0.05 : 0.05;
    totalDutySar += itemCifSar * dutyRate;
  }

  const totalCifSar = totalCifUsd * USD_TO_SAR;
  const totalVatSar = (totalCifSar + totalDutySar) * KSA_VAT_RATE;
  const totalLandedCostSar = totalCifSar + totalDutySar + totalVatSar;
  const cleared = !flags.some(f => f.level === 'BLOCKER');

  // 4. Canonical Hash (SHA-256)
  const canonicalPayload = JSON.stringify({
    shipment_id: payload.shipment_id,
    origin_country: payload.origin_country,
    destination_port: payload.destination_port,
    cleared,
    total_cif_usd: Number(totalCifUsd.toFixed(2)),
    total_landed_cost_sar: Number(totalLandedCostSar.toFixed(2)),
    flags_count: flags.length
  });

  const verificationDigest = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

  return {
    shipment_id: payload.shipment_id,
    cleared,
    timestamp_utc: new Date().toISOString(),
    total_cif_usd: Number(totalCifUsd.toFixed(2)),
    estimated_duty_sar: Number(totalDutySar.toFixed(2)),
    estimated_vat_sar: Number(totalVatSar.toFixed(2)),
    total_landed_cost_sar: Number(totalLandedCostSar.toFixed(2)),
    flags,
    verification_digest: verificationDigest
  };
}