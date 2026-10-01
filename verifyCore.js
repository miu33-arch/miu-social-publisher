import { mixArchitecturalAudio } from "./services/audioMixer.js";
import fs from "fs";
import path from "path";

async function runSovereignCheck() {
  console.log("⚡ [MIU Core] Initiating local metal verification...");
  
  try {
    const testOutputPath = path.resolve("./sovereign_test_output.mp3");
    
    // Test-fire audio mixer fallback generation (sine-wave ambient tone)
    const result = await mixArchitecturalAudio({
      voicePath: "./non_existent_voice.mp3", // Forces local fallback test
      targetDuration: 5,
      stylePreset: "cyberpunk",
      outputPath: testOutputPath,
    });

    if (fs.existsSync(result)) {
      console.log(`✅ [SUCCESS] Local audio pipeline verified. Output generated at: ${result}`);
      fs.unlinkSync(result); // Cleanup test artifact
    } else {
      throw new Error("Output file was not written to local storage.");
    }
  } catch (err) {
    console.error("❌ [CRITICAL FAILURE] Local execution failed:", err.message);
  }
}

runSovereignCheck();