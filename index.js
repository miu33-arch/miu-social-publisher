import { fal } from "@fal-ai/client";
import { exec } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import https from "https";
import path from "path";
import { EdgeTTS } from "node-edge-tts";

dotenv.config();
fal.config({ credentials: process.env.FAL_KEY });

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
};

const runCommand = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
};

function generateAssSubtitles(whisperChunks) {
  let assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTokStyle,Arial,65,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const formatTime = (seconds) => {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(1, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    const ms = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  let events = "";
  whisperChunks.forEach((chunk) => {
    const start = formatTime(chunk.timestamp[0]);
    const end = formatTime(chunk.timestamp[1]);
    const text = chunk.text.trim().toUpperCase();
    events += `Dialogue: 0,${start},${end},TikTokStyle,,0,0,0,,${text}\n`;
  });

  return assHeader + events;
}

const STYLE_PROMPTS = {
  cyberpunk: "cyberpunk, neon-lit lights, dark aesthetic, rainy urban streets, high contrast, photorealistic",
  cinematic: "cinematic photorealistic, 8k resolution, architectural visualization, film grain, dramatic lighting",
  anime: "dark anime style, graphic novel illustration, vibrant cel shading, detailed artwork",
  "3d-render": "3d unreal engine 5 render, octave render, ultra-detailed architectural textures, ray tracing",
  vintage: "1980s vintage film, VHS tape texture, retro color grading, nostalgic warm glow",
};

export async function runAutonomousEngine(userPromptTopic, options = {}) {
  const targetDuration = Number(options.duration) || 30;
  const stylePreset = options.stylePreset || "cyberpunk";
  const aspectRatio = options.aspectRatio || "9:16";
  
  const sceneCount = Math.max(2, Math.ceil(targetDuration / 5));
  const styleModifier = STYLE_PROMPTS[stylePreset] || STYLE_PROMPTS.cyberpunk;

  console.log(`\n🚀 [Autonomous Engine] Generating Reel for: "${userPromptTopic}"`);
  console.log(`⏱️ Duration: ${targetDuration}s (${sceneCount} scenes) | Style: ${stylePreset} | Ratio: ${aspectRatio}\n`);

  // Dynamically constructed narrative narration via Gemini
  let generatedScript = options.narrationText;

  if (!generatedScript) {
    try {
      const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Write an immersive 2-3 sentence cinematic narration voiceover script about: "${userPromptTopic}".
Tone / Style: "${styleModifier}".
Target spoken length: ${Math.round(targetDuration * 2.3)} words.
Rules:
- NEVER use generic slogans or repetitive architectural catchphrases.
- Adapt tone, vocabulary, and intensity directly to the chosen style.
- Output ONLY the clean spoken narration words.`
            }]
          }]
        })
      });
      const aiData = await aiResponse.json();
      generatedScript = aiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    } catch (err) {
      console.warn("⚠️ [Narration Generation Fallback]:", err.message);
    }
  }

  if (!generatedScript) {
    generatedScript = `Observing ${userPromptTopic}. Defined by high-fidelity structural execution, immersive atmosphere, and precise design intelligence.`;
  }
  
  const scenes = [];
  for (let i = 0; i < sceneCount; i++) {
    scenes.push({
      keyframePrompt: `Scene ${i + 1} of ${sceneCount}: ${userPromptTopic}, ${styleModifier}, dynamic perspective, masterfully composed, cinematic framing, 8k render`,
      motionPrompt: "Subtle dramatic cinematic camera motion, atmospheric lighting shift, steady tracking, high quality"
    });
  }

  const tempVideoPaths = [];
  const audioPath = `./temp_voice_${Date.now()}.mp3`;
  const concatListPath = `./concat_list_${Date.now()}.txt`;
  const stitchedVideoPath = `./temp_stitched_${Date.now()}.mp4`;
  const mergedVideoAudioPath = `./temp_merged_${Date.now()}.mp4`;
  const subtitlePath = `./temp_subtitles_${Date.now()}.ass`;
  const finalOutputPath = `./final_reel_${Date.now()}.mp4`;

  console.log(`⚡ Dispatching ${sceneCount} parallel scene generations via fal.ai...`);
  
  const scenePromises = scenes.map(async (scene, index) => {
    console.log(`🎬 Rendering Scene [${index + 1}/${sceneCount}]...`);

    const imageResult = await fal.subscribe("fal-ai/flux/schnell", {
      input: { 
        prompt: scene.keyframePrompt, 
        image_size: aspectRatio === "16:9" ? "landscape_16_9" : "portrait_16_9" 
      }
    });
    const keyframeUrl = imageResult.data.images[0].url;

    const videoResult = await fal.subscribe("fal-ai/kling-video/v1.6/standard/image-to-video", {
      input: { 
        image_url: keyframeUrl, 
        prompt: scene.motionPrompt, 
        duration: "5", 
        aspect_ratio: aspectRatio 
      }
    });

    const localScenePath = `./temp_scene_${Date.now()}_${index + 1}.mp4`;
    await downloadFile(videoResult.data.video.url, localScenePath);
    return { index, path: localScenePath };
  });

  const renderedScenes = await Promise.all(scenePromises);
  renderedScenes.sort((a, b) => a.index - b.index);
  renderedScenes.forEach((s) => tempVideoPaths.push(s.path));

  // Synthesize Voiceover
  console.log("🎙️ Synthesizing Voice Track...");
  const tts = new EdgeTTS({ voice: "en-US-AvaNeural", lang: "en-US" });
  await tts.ttsPromise(generatedScript, audioPath);

  // Concatenate Video Clips
  console.log("🎞️ Concatenating Clips with FFmpeg...");
  const concatContent = tempVideoPaths.map((p) => `file '${path.resolve(p)}'`).join("\n");
  fs.writeFileSync(concatListPath, concatContent);
  await runCommand(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${stitchedVideoPath}"`);

  // Merge Audio + Video
  console.log("🎶 Merging Audio & Video Tracks...");
  await runCommand(`ffmpeg -y -i "${stitchedVideoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${mergedVideoAudioPath}"`);

  // Subtitle Transcription via Whisper
  console.log("📝 Generating Word-Level Captions via Whisper...");
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
  const uploadedAudioUrl = await fal.storage.upload(audioBlob);

  const whisperResult = await fal.subscribe("fal-ai/whisper", {
    input: { audio_url: uploadedAudioUrl, chunk_level: "word" }
  });

  console.log("🔥 Burning Styled Captions onto Video...");
  const assData = generateAssSubtitles(whisperResult.data.chunks);
  fs.writeFileSync(subtitlePath, assData);

  const formattedSubPath = path.resolve(subtitlePath).replace(/\\/g, "/").replace(":", "\\:");
  await runCommand(`ffmpeg -y -i "${mergedVideoAudioPath}" -vf "ass='${formattedSubPath}'" -c:a copy "${finalOutputPath}"`);

  console.log(`✅ Reel pipeline finished successfully: ${path.resolve(finalOutputPath)}`);

  // Cleanup temporary workspace files
  tempVideoPaths.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
  [audioPath, concatListPath, stitchedVideoPath, mergedVideoAudioPath, subtitlePath].forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));

  return path.resolve(finalOutputPath);
}