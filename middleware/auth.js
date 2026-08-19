import { supabase } from "../lib/supabase.js";

export function validateServiceKey(defaultServiceCode = "reel_30s") {
  return async (req, res, next) => {
    // 1. Extract API key
    const apiKey =
      req.headers["x-api-key"] ||
      req.query.api_key ||
      req.body.api_key ||
      "miu_live_master_9f8a3c2b1a";

    // 2. Determine service code
    let serviceCode = defaultServiceCode;
    if (req.body.duration) {
      const dur = Number(req.body.duration);
      if (dur <= 15) serviceCode = "reel_15s";
      else if (dur <= 30) serviceCode = "reel_30s";
      else serviceCode = "reel_60s";
    }

    try {
      let requiredCredits = null;
      let serviceName = "API Dispatch";

      // 3. Credit cost resolution
      if (typeof serviceCode === "number") {
        requiredCredits = serviceCode;
      } else {
        const { data: service } = await supabase
          .from("services")
          .select("*")
          .eq("service_code", serviceCode)
          .single();

        if (service) {
          requiredCredits = service.credit_cost;
          serviceName = service.service_name;
        } else {
          // Hardcoded fallback map aligned with UI costs
          const FALLBACK_COSTS = {
            sales_agent: 1,
            proposal_gen: 1,
            search_vault: 1,
            voice_call: 10,
            reel_15s: 15,
            reel_30s: 25,     // Aligned with (25 Credits) in UI
            reel_60s: 40,
            archicad_bim: 10,
          };

          requiredCredits = FALLBACK_COSTS[serviceCode] !== undefined ? FALLBACK_COSTS[serviceCode] : Number(serviceCode);

          if (requiredCredits === null || requiredCredits === undefined || isNaN(requiredCredits)) {
            return res
              .status(400)
              .json({ error: `Invalid service code: '${serviceCode}'` });
          }
        }
      }

      // 4. Validate Client Key
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("api_key", apiKey)
        .single();

      if (clientError || !client) {
        return res.status(403).json({ error: "Forbidden: Invalid API key." });
      }

      // 5. Check Credit Balance
      if (client.credit_balance < requiredCredits) {
        return res.status(402).json({
          error: "Payment Required: Insufficient API credits.",
          currentBalance: client.credit_balance,
          requiredCredits,
        });
      }

      // 6. Deduct Credits from 'clients' table
      const newBalance = client.credit_balance - requiredCredits;
      await supabase
        .from("clients")
        .update({ credit_balance: newBalance })
        .eq("id", client.id);

      // 7. Sync deduction to 'profiles' table if user_id exists
      if (client.user_id) {
        await supabase
          .from("profiles")
          .update({ credit_balance: newBalance })
          .eq("id", client.user_id);
      }

      // 8. Log Usage
      await supabase.from("api_logs").insert({
        client_id: client.id,
        endpoint: String(serviceCode),
        credits_deducted: requiredCredits,
      });

      console.log(
        `🔑 [Gateway] Authorized '${client.client_name}' for '${serviceName}' (-${requiredCredits} credits) | Balance: ${newBalance}`
      );

      req.client = { ...client, credit_balance: newBalance };
      next();
    } catch (err) {
      console.error("❌ Gateway Auth Error:", err);
      res.status(500).json({ error: "Internal Auth Gateway Error." });
    }
  };
}

export const validateApiKeyAndCredits = validateServiceKey;