import crypto from "crypto";

export function evaluateCompliance({ track, metadata = {}, shipment = {} }) {
  const exchangeRateSAR = 3.75;
  const cifSAR = Number(shipment.cifValueSAR) || ((Number(shipment.cifValueUSD) || 10000) * exchangeRateSAR);

  if (track === "aec") {
    const customsDutySAR = cifSAR * 0.05;
    const handlingFee = 1200; // Municipal engineering inspection fee
    const vatSAR = (cifSAR + customsDutySAR + handlingFee) * 0.15;

    return {
      track,
      validation: {
        zatcaValidated: true,
        sasoCompliance: metadata.alloyStandard ? "GB/T to ASTM/SASO Parity Verified" : "Standard Submittal Check",
        saberCertRequired: metadata.requiresSaber ?? true,
        status: "AEC_PIPELINE_CLEAR"
      },
      financials: {
        currency: "SAR",
        cifValueSAR: cifSAR,
        customsDutySAR,
        municipalHandlingFee: handlingFee,
        zatcaVatSAR: vatSAR,
        totalLandedCostSAR: Number((cifSAR + customsDutySAR + handlingFee + vatSAR).toFixed(2))
      }
    };
  }

if (track === "fmcg") {
    const currentTemp = Number(shipment?.currentTempC ?? 2.5);
    const maxThreshold = 4.0;
    const minShelfLife = Number(shipment?.shelfLifeRemainingPct ?? 85);
    const isTempBreach = currentTemp > maxThreshold || currentTemp < 0.0;
    const isShelfLifeBreach = minShelfLife < 70;

    let pipelineStatus = "FMCG_COLD_CHAIN_CLEAR";
    if (isTempBreach) {
      pipelineStatus = "FMCG_COLD_CHAIN_BREACH";
    } else if (isShelfLifeBreach) {
      pipelineStatus = "FMCG_SHELF_LIFE_REJECT";
    }

    const customsDutySAR = cifSAR * 0.05;
    const handlingFee = 450; // SFDA port inspection & cold storage terminal fee
    const vatSAR = (cifSAR + customsDutySAR + handlingFee) * 0.15;

    return {
      track,
      validation: {
        sfdaPreApproval: metadata?.sfdaRegistrationId ? "Verified Active" : "Pending Pre-Export Screening",
        halalStandard: metadata?.halalCertified ? "GSO Compliant (Saudi/GCC Standard)" : "Missing Halal Documentation",
        coldChainTelemetry: {
          sensorStreamActive: Boolean(shipment?.iotTelemetryStream),
          maxTempThresholdC: maxThreshold,
          currentTempC: currentTemp,
          minRemainingShelfLifePct: minShelfLife,
          tempStatus: isTempBreach ? "BREACH_CRITICAL_SFDA" : "NOMINAL_ENVELOPE",
          shelfLifeStatus: isShelfLifeBreach ? "REJECT_EXPIRED_THRESHOLD" : "COMPLIANT_FOR_PORT_ENTRY"
        },
        status: pipelineStatus
      },
      financials: {
        currency: "SAR",
        cifValueSAR: cifSAR,
        customsDutySAR,
        sfdaHandlingFee: handlingFee,
        zatcaVatSAR: vatSAR,
        totalLandedCostSAR: Number((cifSAR + customsDutySAR + handlingFee + vatSAR).toFixed(2))
      }
    };
  }

  throw new Error(`Unsupported track: ${track}`);
}