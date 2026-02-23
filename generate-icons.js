#!/usr/bin/env node
// Run: node generate-icons.js
// Requires: npm install sharp (one-time, not in main deps)

import sharp from "sharp";
import { readFileSync } from "fs";

const svg = readFileSync("./public/icons/icon.svg");

await sharp(svg).resize(192, 192).png().toFile("./public/icons/icon-192.png");
console.log("✅ icon-192.png generated");

await sharp(svg).resize(512, 512).png().toFile("./public/icons/icon-512.png");
console.log("✅ icon-512.png generated");

console.log("Done! Icons saved to public/icons/");
