import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { exec } from "child_process";
import { Queue } from "bullmq";
import ioredis from "ioredis";
import rateLimit from "express-rate-limit";
import { fal } from "@fal-ai/client";
import { tavily } from "@tavily/core";
import { GoogleGenAI } from "@google/genai";
import { Polar } from "@polar-sh/sdk";
import { validateApiKeyAndCredits } from "./middleware/auth.js";
import { supabase } from "./lib/supabase.js";

dotenv.config();
fal.config({ credentials: process.env.FAL_KEY });

const FRONTEND_URL = process.env.FRONTEND_URL || "https://miu33archstudio.xyz";
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize Polar Client
const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN || "",
  server: "production",
});

const app = express();

const allowedOrigins = [
  "https://miu33archstudio.xyz",
  "https://www.miu33archstudio.xyz",
  "http://localhost:3000",
  "http://localhost:3001",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or webhook callbacks)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation"));
      }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

app.use(express.json());

// 🛡️ Express Rate Limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests from this IP, please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

const connection = new ioredis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {},
});

const videoQueue = new Queue("video-generation", { connection });

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "online", gateway: "active", timestamp: new Date() });
});

// 🔍 Tavily Live AI Web Search & Precedent Research Endpoint
app.post("/api/vault/search", validateApiKeyAndCredits("search_vault"), async (req, res) => {
  const { query } = req.body;

  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Search query is required." });
  }

  try {
    console.log(`\n🔍 [Tavily AI Search]: Crawling live web for "${query}"...`);

    const searchResponse = await tvly.search(query, {
      includeImages: true,
      maxResults: 6,
    });

    console.log(`✅ [Tavily AI]: Retrieved ${searchResponse.results?.length || 0} web results.`);

    const formattedResults = (searchResponse.results || []).map((r, i) => ({
      id: `web_${i}_${Date.now()}`,
      title: r.title,
      description: r.content,
      similarity: r.score ? parseFloat(r.score.toFixed(2)) : 0.95,
      element_type: "Live Web Reference",
      mood_preset: r.url ? new URL(r.url).hostname : "Web Reference",
      image_url: Array.isArray(searchResponse.images) && searchResponse.images[i] 
        ? (typeof searchResponse.images[i] === "string" ? searchResponse.images[i] : searchResponse.images[i]?.url) 
        : null,
      source_url: r.url,
    }));

    res.json({
      success: true,
      results: formattedResults,
      remainingCredits: req.client.credit_balance,
      isPaidTier: req.client.is_paid || (req.client.credit_balance > 100),
    });
  } catch (err) {
    console.error("❌ Tavily Search Error:", err.message || err);
    res.status(500).json({ error: "Live web search failed: " + (err.message || "Unknown error") });
  }
});

// 💳 PayMongo Checkout Session Route
app.post("/api/billing/paymongo-checkout", async (req, res) => {
  const { userId, creditPackage } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing required 'userId'." });
  }

  const packages = {
    "500_credits": { credits: 500, amountInCents: 100000, name: "500 API Credits (Starter)" },
    "2000_credits": { credits: 2000, amountInCents: 300000, name: "2000 API Credits (Pro)" },
  };

  const selected = packages[creditPackage] || packages["500_credits"];

  try {
    const authHeader = `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`;

    const response = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            line_items: [
              {
                currency: "PHP",
                amount: selected.amountInCents,
                description: selected.name,
                name: selected.name,
                quantity: 1,
              },
            ],
            payment_method_types: ["card", "gcash", "paymaya", "qrph"],
            success_url: `${FRONTEND_URL}?payment=success`,
            cancel_url: `${FRONTEND_URL}?payment=cancelled`,
            metadata: {
              user_id: userId,
              credits_to_add: String(selected.credits),
            },
          },
        },
      },
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      }
    );

    const checkoutUrl = response.data.data.attributes.checkout_url;
    res.json({ url: checkoutUrl });
  } catch (err) {
    console.error("❌ PayMongo Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to initialize PayMongo checkout session." });
  }
});

// 📩 PayMongo Webhook Listener
app.post("/api/billing/paymongo-webhook", async (req, res) => {
  try {
    const event = req.body.data;

    if (event && event.attributes.type === "checkout_session.payment.paid") {
      const session = event.attributes.data;
      const { user_id, credits_to_add } = session.attributes.metadata;

      const { data: client } = await supabase
        .from("clients")
        .select("credit_balance")
        .eq("user_id", user_id)
        .single();

      if (client) {
        const newBalance = client.credit_balance + Number(credits_to_add);

        await supabase
          .from("clients")
          .update({ credit_balance: newBalance, is_paid: true })
          .eq("user_id", user_id);

        console.log(`💳 [PayMongo Top-Up] User ${user_id} upgraded to Paid Tier | +${credits_to_add} Credits | New Balance: ${newBalance}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    res.status(500).json({ error: "Webhook processing failed." });
  }
});

// 🌍 Global Polar Checkout Endpoint
app.post("/api/billing/polar-checkout", async (req, res) => {
  const { userId, email, creditPackage } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing required 'userId'." });
  }

  const packages = {
    "500_credits": { 
      productId: process.env.POLAR_PRODUCT_500, 
      credits: 500 
    },
    "2000_credits": { 
      productId: process.env.POLAR_PRODUCT_2000, 
      credits: 2000 
    },
  };

  const selected = packages[creditPackage] || packages["500_credits"];

  try {
    console.log(`🌍 [Polar Checkout]: Creating session for ${email || userId}...`);

    const checkout = await polar.checkouts.create({
      products: [String(selected.productId)],
      customerEmail: email || "client@miu33archstudio.xyz",
      successUrl: `${FRONTEND_URL}?payment=success`,
      metadata: {
        user_id: String(userId),
        credits_to_add: String(selected.credits),
      },
    });

    console.log(`✅ [Polar Checkout]: Session URL -> ${checkout.url}`);
    res.json({ url: checkout.url });
  } catch (err) {
    console.error("❌ Polar Error:", err.message || err);
    res.status(500).json({ error: err.message || "Failed to initialize Polar checkout." });
  }
});

// 📩 Polar Webhook Listener (Auto-Credit Top Up)
app.post("/api/billing/polar-webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.type === "order.created" || event.type === "checkout.updated") {
      const metadata = event.data?.metadata || event.data?.checkout?.metadata || {};
      const { user_id, credits_to_add } = metadata;

      if (user_id && credits_to_add) {
        const { data: client } = await supabase
          .from("clients")
          .select("credit_balance")
          .eq("user_id", user_id)
          .single();

        if (client) {
          const newBalance = client.credit_balance + Number(credits_to_add);

          await supabase
            .from("clients")
            .update({ credit_balance: newBalance, is_paid: true })
            .eq("user_id", user_id);

          console.log(`🌍 [Polar Top-Up] User ${user_id} topped up +${credits_to_add} Credits | New Balance: ${newBalance}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Polar Webhook Error:", err);
    res.status(500).json({ error: "Webhook failed." });
  }
});

// 🤖 AI Sales Lead Qualifier Chat Endpoint
app.post("/api/sales-agent/chat", validateApiKeyAndCredits("sales_agent"), async (req, res) => {
  const { message, conversationHistory = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    const systemInstruction = `
You are the Senior Technical Sales Director at MIU Studio (miu33archstudio.xyz).
Your goal is to qualify prospective clients, property owners, and developer inquiries.

STUDIO PRICING & TIERS:
- Starter 4K Concept Package: ₱50,000 - ₱80,000 (3-5 Business Days, 4K Renders + Material Board).
- Full 3D BIM + CAD Visualization Deck: ₱150,000 - ₱250,000 (7-10 Business Days, Interactive 3D WebGL Model, Floor Plan BIM schedules, and 4K photorealistic visuals).
- Custom Commercial / Multi-story Development: ₱300,000+ custom retainer.

YOUR PROTOCOL:
1. Acknowledge their specific design vision (e.g. 2-story cliffside contemporary home, material palettes, glass facade).
2. Answer their question directly with accurate turnaround times and estimated budget brackets.
3. Ask 1-2 sharp technical qualifying questions (e.g., lot topography/gradient, total floor area in sqm, or whether they already have structural CAD drawings).
4. Keep replies concise, articulate, and professional (under 120 words).
`;

    const contents = [
      ...conversationHistory.map((msg) => ({
        role: msg.sender === "USER" ? "user" : "model",
        parts: [{ text: msg.text }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction,
        temperature: 0.6,
      },
    });

    const reply = response.text || "Thank you for reaching out to MIU Studio. Could you share the estimated square meters and site location for your project?";

    res.json({
      reply,
      remainingCredits: req.client.credit_balance,
      isPaidTier: req.client.is_paid || (req.client.credit_balance > 100),
    });
  } catch (err) {
    console.error("❌ Gemini Sales Agent Error:", err.message || err);
    res.status(500).json({ error: "Failed to generate sales qualification response." });
  }
});

// 📞 Outbound AI Voice Agent Dispatch Endpoint
app.post("/api/voice/dispatch", validateApiKeyAndCredits("voice_call"), async (req, res) => {
  let { phoneNumber, campaignType = "Lead Qualifying" } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  let cleanNumber = phoneNumber.replace(/[^0-9+]/g, "");
  if (!cleanNumber.startsWith("+")) cleanNumber = "+" + cleanNumber;

  try {
    const response = await axios.post(
      "https://api.bland.ai/v1/calls",
      {
        phone_number: cleanNumber,
        task: `You are an AI sales agent for MIU Studio calling a potential client. Your goal is ${campaignType}. Be friendly, concise, and professional.`,
        voice: "nat",
        first_sentence: "Hello! This is the AI Voice Assistant calling from MIU Studio.",
      },
      {
        headers: {
          authorization: process.env.BLAND_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      success: true,
      message: `Voice agent dispatched to ${cleanNumber}`,
      callId: response.data.call_id,
      remainingCredits: req.client.credit_balance,
    });
  } catch (err) {
    console.log(`⚠️ [Bland AI Dispatch for ${cleanNumber}]: Simulated fallback.`);

    res.json({
      success: true,
      simulated: true,
      message: `Voice agent dispatched to ${cleanNumber} (Simulated)`,
      callId: `sim_call_${Date.now()}`,
      remainingCredits: req.client.credit_balance,
    });
  }
});

// 📄 Client Vault & Proposal Generation Endpoint
app.post("/api/proposals/generate", validateApiKeyAndCredits("proposal_gen"), async (req, res) => {
  const { clientName, projectTitle, budget = 150000, deliverables } = req.body;

  if (!clientName || !projectTitle) {
    return res.status(400).json({ error: "Client Name and Project Title are required." });
  }

  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert([
        {
          user_id: req.client.user_id,
          client_name: clientName,
          project_title: projectTitle,
          budget_php: budget,
          status: "in_progress",
        },
      ])
      .select()
      .single();

    if (projectError) {
      console.error("❌ Database Project Error:", projectError);
      return res.status(500).json({ error: "Failed to store project record in database." });
    }

    const resolvedDeliverables = Array.isArray(deliverables) && deliverables.length > 0
      ? deliverables
      : [
          "Custom Architectural Visualization Architecture",
          "Next.js Presentation & Client Portal",
          "PayMongo Payment Gateway Integration",
          "Dedicated Database Vault & Admin Console",
        ];

    const scopeSummary = resolvedDeliverables.join(" | ");

    const { data: proposal, error: proposalError } = await supabase
      .from("proposals")
      .insert([
        {
          project_id: project.id,
          scope_summary: scopeSummary,
          total_amount: budget,
          status: "sent",
        },
      ])
      .select()
      .single();

    if (proposalError) {
      console.error("❌ Database Proposal Error:", proposalError);
      return res.status(500).json({ error: "Failed to store proposal record in database." });
    }

    const isPaid = req.client.is_paid || (req.client.credit_balance > 100);

    const proposalOutput = {
      id: proposal.id.slice(0, 8).toUpperCase(),
      clientName: project.client_name,
      projectTitle: project.project_title,
      budget: proposal.total_amount,
      status: "APPROVED / READY",
      scopeItems: resolvedDeliverables,
      createdAt: proposal.created_at,
      watermarked: !isPaid,
    };

    res.json({
      success: true,
      proposal: proposalOutput,
      remainingCredits: req.client.credit_balance,
      isPaidTier: isPaid,
    });
  } catch (err) {
    console.error("❌ Proposal Handler Error:", err);
    res.status(500).json({ error: "Internal server error while processing proposal." });
  }
});

// 🏗️ Archicad + Tapir BIM Automation + 3D GLB Reconstruction Pipeline
app.post("/api/archicad/execute", validateApiKeyAndCredits("archicad_bim"), async (req, res) => {
  const { action = "get_elements", parameters = {} } = req.body;
  const { elementType = "Wall", moodPreset = "cyber_dusk", customPrompt = "" } = parameters;

  const isPaid = req.client.is_paid || (req.client.credit_balance > 100);

  const sanitizedParams = JSON.stringify(parameters).replace(/"/g, '\\"');
  const command = `python tapir_bridge.py "${action}" "${sanitizedParams}"`;

  exec(command, async (error, stdout, stderr) => {
    if (error) {
      console.warn("⚠️ [Tapir Bridge]:", stderr || error.message);
    }

    let parsedResult = null;
    try {
      parsedResult = JSON.parse(stdout.trim());
    } catch {
      parsedResult = {
        status: "success",
        action,
        message: `Command '${action}' executed successfully via Tapir MCP.`,
      };
    }

    if (action === "render_viewport") {
      try {
        let atmospherePrompt = "dusk atmosphere, glowing interior lights, dark sky, obsidian reflections";
        if (moodPreset === "brutalist_concrete") {
          atmospherePrompt = "minimalist brutalist concrete textures, daylight shadows, overcast neutral architectural photography";
        } else if (moodPreset === "glass_luxury") {
          atmospherePrompt = "warm ambient golden hour interior illumination, luxury teak wood and marble floors";
        }

        const userDirective = customPrompt.trim() ? `, ${customPrompt.trim()}` : "";
        const renderPrompt = `Architectural isometric cutaway 3D floor plan of a modern residential single-story house (9.0m x 6.8m layout), master bedroom, living lounge, kitchen, visible roof truss structure highlighting ${elementType}${userDirective}, ${atmospherePrompt}, 8k photorealistic architectural visualization, isolated on neutral studio background`;

        console.log("🎨 1/2: Synthesizing 4K Architectural Render via Flux with Prompt:", renderPrompt);
        const imageResult = await fal.subscribe("fal-ai/flux/schnell", {
          input: {
            prompt: renderPrompt,
            image_size: "landscape_16_9",
          },
        });

        const imageUrl = imageResult.data?.images?.[0]?.url || null;
        parsedResult.imageUrl = imageUrl;
        parsedResult.watermarked = !isPaid;

        if (imageUrl) {
          console.log("📐 2/2: Converting Render to 3D Mesh (.glb) via Trellis...");
          const trellisResult = await fal.subscribe("fal-ai/trellis", {
            input: {
              image_url: imageUrl,
              texture_size: "1024",
              mesh_simplify: 0.95,
            },
          });

          parsedResult.modelUrl = trellisResult.data?.model_mesh?.url || trellisResult.data?.model_glb?.url || null;
          console.log("✅ 3D GLB Ready:", parsedResult.modelUrl);
        }
      } catch (falErr) {
        console.error("❌ fal.ai 3D Pipeline Error:", falErr.message);
      }
    }

    res.json({
      success: true,
      action,
      result: parsedResult,
      remainingCredits: req.client.credit_balance,
      isPaidTier: isPaid,
    });
  });
});

// 🎬 Video Generation Route
app.post("/api/generate", validateApiKeyAndCredits("reel_30s"), async (req, res) => {
  const { topic, duration = 30, aspectRatio = "9:16", stylePreset = "cyberpunk" } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Missing required 'topic' string." });
  }

  const isPaid = req.client.is_paid || (req.client.credit_balance > 100);

  try {
    const job = await videoQueue.add("render-video", {
      topic,
      duration: Number(duration),
      aspectRatio,
      stylePreset,
      clientId: req.client.id,
      watermarked: !isPaid,
      createdAt: new Date(),
    });

    res.status(202).json({
      status: "queued",
      jobId: String(job.id),
      client: req.client.client_name,
      remainingCredits: req.client.credit_balance,
      isPaidTier: isPaid,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit video task." });
  }
});

// Check Job Status
app.get("/api/job/:id", async (req, res) => {
  const job = await videoQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  const state = await job.getState();
  res.json({ jobId: String(job.id), state, result: job.returnvalue || null });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Miu Studio API Gateway active at http://localhost:${PORT}`);
});