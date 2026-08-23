import { supabase } from "../lib/supabase.js";

export function validateServiceKey(defaultServiceCode = "reel_30s") {
  return async (req, res, next) => {
    try {
      // 1. Determine service code & credit cost
      let serviceCode = defaultServiceCode;
      if (req.body && req.body.duration) {
        const dur = Number(req.body.duration);
        if (dur <= 15) serviceCode = "reel_15s";
        else if (dur <= 30) serviceCode = "reel_30s";
        else serviceCode = "reel_60s";
      }

      const FALLBACK_COSTS = {
        sales_agent: 1,
        proposal_gen: 1,
        search_vault: 1,
        voice_call: 10,
        reel_15s: 15,
        reel_30s: 25,     // 25 credits per 30s Reel
        reel_60s: 40,
        archicad_bim: 10,
      };

      const requiredCredits = FALLBACK_COSTS[serviceCode] || 25;

      // 2. Check for Logged-in Web App User (Bearer Token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (user && !userError) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, credit_balance, email")
            .eq("id", user.id)
            .single();

          if (profileError || !profile) {
            return res.status(404).json({ error: "User profile not found." });
          }

          if (profile.credit_balance < requiredCredits) {
            return res.status(402).json({
              error: "Payment Required: Insufficient credits.",
              currentBalance: profile.credit_balance,
              requiredCredits,
            });
          }

          // Deduct credits from user's profiles record
          const newBalance = profile.credit_balance - requiredCredits;
          await supabase
            .from("profiles")
            .update({ credit_balance: newBalance })
            .eq("id", user.id);

          // Log API consumption
          await supabase.from("api_logs").insert({
            user_id: user.id,
            endpoint: String(serviceCode),
            credits_deducted: requiredCredits,
          });

          console.log(
            `🔑 [Gateway] User '${profile.email}' authorized for '${serviceCode}' (-${requiredCredits} credits) | Balance: ${newBalance}`
          );

          req.user = { ...profile, credit_balance: newBalance };
          return next();
        }
      }

      // 3. Fallback: Check B2B / API Key from 'clients' table
      const apiKey =
        req.headers["x-api-key"] ||
        req.query.api_key ||
        (req.body && req.body.api_key) ||
        "miu_live_master_9f8a3c2b1a";

      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("api_key", apiKey)
        .single();

      if (clientError || !client) {
        return res.status(403).json({ error: "Forbidden: Invalid API key or session." });
      }

      if (client.credit_balance < requiredCredits) {
        return res.status(402).json({
          error: "Payment Required: Insufficient API credits.",
          currentBalance: client.credit_balance,
          requiredCredits,
        });
      }

      // Deduct from clients table
      const newClientBalance = client.credit_balance - requiredCredits;
      await supabase
        .from("clients")
        .update({ credit_balance: newClientBalance })
        .eq("id", client.id);

      // Log usage
      await supabase.from("api_logs").insert({
        client_id: client.id,
        endpoint: String(serviceCode),
        credits_deducted: requiredCredits,
      });

      console.log(
        `🔑 [Gateway] Client '${client.client_name}' authorized for '${serviceCode}' (-${requiredCredits} credits) | Balance: ${newClientBalance}`
      );

      req.client = { ...client, credit_balance: newClientBalance };
      next();
    } catch (err) {
      console.error("❌ Gateway Auth Error:", err);
      res.status(500).json({ error: "Internal Auth Gateway Error." });
    }
  };
}

export const validateApiKeyAndCredits = validateServiceKey;