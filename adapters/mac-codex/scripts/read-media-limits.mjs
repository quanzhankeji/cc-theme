#!/usr/bin/env node

import fs from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: read-media-limits.mjs <media-limits.json>");

const limits = JSON.parse(fs.readFileSync(path, "utf8"));
if (limits.contract !== "cc-theme.media-limits" || limits.revision !== 1) {
  throw new Error("Unsupported CC Theme media limits contract");
}

const keys = [
  "imageBytes",
  "standardVideoBytes",
  "largeVideoBytes",
  "totalThemeMediaBytes",
  "packageBytes",
];
const values = keys.map((key) => {
  const value = limits[key];
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid media limit: ${key}`);
  }
  return String(value);
});

process.stdout.write(values.join("\t"));
