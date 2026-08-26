const fs = require("fs");
const path = require("path");

const dirs = ["C:/Synco2-main/frontend/app", "C:/Synco2-main/frontend/src"];

// All common non-ASCII characters in Spanish and general artifacts
const map = {
  "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n",
  "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ñ": "N",
  "¿": "?", "¡": "!", "º": "o", "ª": "a", "”": "\"", "“": "\"", "’": "'", "‘": "'"
};

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
      // Read as Buffer to detect UTF-8
      let buffer = fs.readFileSync(p);
      let content = buffer.toString("utf8");

      let changed = false;
      // 1. Replace mapped characters
      for (const [k, v] of Object.entries(map)) {
        if (content.includes(k)) {
          content = content.split(k).join(v);
          changed = true;
        }
      }

      // 2. Aggressive regex to catch ANY non-ASCII character remaining
      // This is a safety net for encoding corruption artifacts (e.g. Ã³)
      if (/[^\x00-\x7f]/.test(content)) {
        content = content.replace(/[^\x00-\x7f]/g, "_");
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(p, content, "ascii"); // Write as ASCII to force errors if we missed something
        console.log("Fixed: " + p);
      }
    }
  });
}

dirs.forEach(walk);
console.log("Encoding fix completed.");
