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
        social_broadcast: 2,
        voice_call: 10,
        reel_15s: 15,
        reel_30s: 25,
        reel_60s: 40,
        archicad_bim: 10,
      };

      const requiredCredits = FALLBACK_COSTS[serviceCode] || 1;

      // 2. Check for Logged-in Web App User (Bearer Token)
      const authHeader = req.headers.authorization;
      const rawApiKey =
        req.headers["x-api-key"] ||
        req.query.api_key ||
        (req.body && req.body.api_key);

      let user = null;
      let profile = null;
      let client = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);
        if (authUser && !userError) {
          user = authUser;

          // Fetch profile and linked client
          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, credit_balance, email, tier")
            .eq("id", user.id)
            .maybeSingle();
          profile = profileData;

          const { data: clientData } = await supabase
            .from("clients")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();
          client = clientData;
        }
      }

      // 3. Fallback: Search client by API key if no Bearer token or client not found
      if (!client && rawApiKey) {
        const { data: clientByKey } = await supabase
          .from("clients")
          .select("*")
          .eq("api_key", rawApiKey)
          .maybeSingle();
        client = clientByKey;
      }

      // 4. Admin & Master Key Exemptions
      const isAdmin =
        user?.email === "padillaanamy83@gmail.com" ||
        user?.id === "172461ed-2ad1-46f7-a913-1e3b1ae64a9e" ||
        client?.api_key === "miu_live_master_9f8a3c2b1a" ||
        rawApiKey === "miu_live_master_9f8a3c2b1a";

      if (isAdmin) {
        const activeBalance = client?.credit_balance ?? profile?.credit_balance ?? 500;
        const adminPayload = {
          id: client?.id || profile?.id || "admin_master",
          user_id: user?.id || "172461ed-2ad1-46f7-a913-1e3b1ae64a9e",
          client_name: user?.email || "Miu Studio Admin",
          credit_balance: activeBalance,
          is_paid: true,
          tier: "PRO",
        };

        req.user = adminPayload;
        req.client = adminPayload;
        return next();
      }

      // 5. Standard User Credit Validation
      if (!user && !client) {
        return res.status(401).json({ error: "Unauthorized: Missing API key or Bearer token." });
      }

      const currentBalance = client?.credit_balance ?? profile?.credit_balance ?? 0;

      if (currentBalance < requiredCredits) {
        return res.status(402).json({
          error: "Payment Required: Insufficient credits.",
          currentBalance,
          requiredCredits,
        });
      }

      const newBalance = currentBalance - requiredCredits;

      // Sync deduction across both tables
      if (client?.id) {
        await supabase
          .from("clients")
          .update({ credit_balance: newBalance })
          .eq("id", client.id);
      }

      if (user?.id) {
        await supabase
          .from("profiles")
          .update({ credit_balance: newBalance })
          .eq("id", user.id);
      }

      await supabase.from("api_logs").insert({
        user_id: user?.id || null,
        client_id: client?.id || null,
        endpoint: String(serviceCode),
        credits_deducted: requiredCredits,
      });

      const clientPayload = {
        id: client?.id || profile?.id,
        user_id: user?.id || client?.user_id,
        client_name: client?.client_name || user?.email,
        credit_balance: newBalance,
        is_paid: profile?.tier === "PRO" || client?.is_paid || newBalance > 100,
      };

      req.user = clientPayload;
      req.client = clientPayload;
      next();
    } catch (err) {
      console.error("❌ Gateway Auth Error:", err);
      res.status(500).json({ error: "Internal Auth Gateway Error." });
    }
  };
}

export const validateApiKeyAndCredits = validateServiceKey;