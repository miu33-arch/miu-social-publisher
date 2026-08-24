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
        social_broadcast: 2,  // Lightweight credit charge for multi-network broadcast
        voice_call: 10,
        reel_15s: 15,
        reel_30s: 25,
        reel_60s: 40,
        archicad_bim: 10,
      };

      const requiredCredits = FALLBACK_COSTS[serviceCode] || 2;

      // 2. Check for Logged-in Web App User (Bearer Token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (user && !userError) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, credit_balance, email, tier")
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

          // Normalize both req.user and req.client so server.js handlers never crash
          const clientPayload = {
            id: profile.id,
            user_id: user.id,
            client_name: profile.email,
            credit_balance: newBalance,
            is_paid: profile.tier === "PRO" || newBalance > 100,
          };

          req.user = clientPayload;
          req.client = clientPayload;
          return next();
        }
      }

      // 3. Fallback: Check B2B / API Key from 'clients' table
      const apiKey =
        req.headers["x-api-key"] ||
        req.query.api_key ||
        (req.body && req.body.api_key);

      if (!apiKey) {
        return res.status(401).json({ error: "Unauthorized: Missing API key or Bearer token." });
      }

      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (clientError || !client) {
        return res.status(403).json({ error: "Forbidden: Invalid API key." });
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
      req.user = req.client;
      next();
    } catch (err) {
      console.error("❌ Gateway Auth Error:", err);
      res.status(500).json({ error: "Internal Auth Gateway Error." });
    }
  };
}

export const validateApiKeyAndCredits = validateServiceKey;