import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { Worker } from "bullmq";
import ioredis from "ioredis";
import fs from "fs";
import dotenv from "dotenv";
import { runAutonomousEngine } from "./index.js";
import { supabase } from "./lib/supabase.js";

dotenv.config();

const connection = new ioredis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {},
});

console.log("🛠️ BullMQ Video Generation Worker process active...");

const worker = new Worker(
  "video-generation",
  async (job) => {
    const { topic, duration, aspectRatio, stylePreset } = job.data;
    
    console.log(
      `\n⚙️ [Worker] Processing Job #${job.id} | Topic: "${topic}" | Duration: ${duration}s | Ratio: ${aspectRatio} | Style: ${stylePreset}`
    );

    // 1. Trigger dynamic generative video pipeline
    const localMp4Path = await runAutonomousEngine(topic, {
      duration: duration || 30,
      aspectRatio: aspectRatio || "9:16",
      stylePreset: stylePreset || "cyberpunk",
    });

    // 2. Upload output MP4 to Supabase Storage
    console.log("☁️ [Worker] Uploading rendered MP4 to Supabase Storage CDN...");
    const fileName = `reel_${Date.now()}_${job.id}.mp4`;
    const fileBuffer = fs.readFileSync(localMp4Path);

    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    const { error: uploadError } = await supabase.storage
      .from("episodes")
      .upload(fileName, arrayBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      console.error("❌ Supabase Upload Failed:", uploadError);
      throw new Error(`Storage upload error: ${uploadError.message}`);
    }

    // 3. Resolve Public CDN URL
    const { data: publicUrlData } = supabase.storage
      .from("episodes")
      .getPublicUrl(fileName);

    const publicUrl = publicUrlData.publicUrl;
    console.log(`🎉 [Worker] Job #${job.id} finished! CDN Link:\n👉 ${publicUrl}`);

    // Cleanup local MP4
    if (fs.existsSync(localMp4Path)) {
      fs.unlinkSync(localMp4Path);
    }

    return { videoUrl: publicUrl };
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`✅ [Worker] Job #${job.id} marked completed.`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ [Worker] Job #${job.id} failed: ${err.message}`);
});