// src/store.js
// Tiny JSON-file persistence for data/*.json (topic history, home base,
// last draft). Same commit-back-to-repo pattern as v1.

import { readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Resolve data/ relative to this module (repo root), NOT the process cwd —
// so the bot works no matter where it's started from.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export async function readJson(name, fallback) {
  try {
    const raw = await readFile(join(DATA_DIR, name), "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(name, value) {
  await writeFile(
    join(DATA_DIR, name),
    JSON.stringify(value, null, 2) + "\n",
    "utf-8"
  );
}
