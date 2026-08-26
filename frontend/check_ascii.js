const fs = require("fs");
const files = ["C:/Synco2-main/frontend/src/api.ts", "C:/Synco2-main/frontend/app/(coord)/projects/[id]/index.tsx"];

files.forEach(f => {
  if (!fs.existsSync(f)) {
    console.log(`File not found: ${f}`);
    return;
  }
  const data = fs.readFileSync(f);
  let nonAscii = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 127) nonAscii.push({ pos: i, byte: data[i] });
  }
  if (nonAscii.length > 0) {
    console.log(`File: ${f} HAS ${nonAscii.length} NON-ASCII BYTES!`);
    console.log(`First 5:`, nonAscii.slice(0, 5));
  } else {
    console.log(`File: ${f} is PURE ASCII.`);
  }
});
