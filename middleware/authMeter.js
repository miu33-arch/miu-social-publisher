import { getClientByKey, deductClientCredits } from "../services/core/dbStore.js";

// Service credit costs
const SERVICE_RATES = {
  "process_asset": 1.0,     // 1 credit per render pass
  "batch_export": 3.0,      // 3 credits for all 3 aspect ratios
  "video_stitch": 2.0,      // 2 credits per master stitch
  "audio_mix": 1.0,         // 1 credit per audio balance
  "hud_telemetry": 1.5,     // 1.5 credits per HUD overlay
};

export function requireMeteredAuth(serviceType) {
  return (req, res, next) => {
    // Check x-api-key header or fallback to default master key for local UI calls
    const apiKey = req.headers["x-api-key"] || req.query.apiKey || "miu_master_agency_key";

    const client = getClientByKey(apiKey);
    if (!client) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid or missing x-api-key header."
      });
    }

    const cost = SERVICE_RATES[serviceType] || 1.0;

    if (client.plan !== "agency_unlimited" && client.creditsRemaining < cost) {
      return res.status(402).json({
        success: false,
        error: `Payment Required: Insufficient credits. Operation requires ${cost} credits, current balance: ${client.creditsRemaining}.`
      });
    }

    // Attach client context to request
    req.apiClient = client;
    req.serviceCost = cost;
    req.serviceType = serviceType;

    // Deduct on completion helper
    req.finalizeCredits = (durationSeconds = 0) => {
      if (client.plan !== "agency_unlimited") {
        return deductClientCredits({
          apiKey,
          serviceType,
          credits: cost,
          durationSeconds
        });
      }
      return { success: true, remainingBalance: client.creditsRemaining, plan: "unlimited" };
    };

    next();
  };
}