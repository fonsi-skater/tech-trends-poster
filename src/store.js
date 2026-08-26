// src/store.js
// Tiny JSON-file persistence for data/*.json (topic history, home base,
// last draft). Same commit-back-to-repo pattern as v1.

import { readFile, writeFile } from "fs/promises";

const DATA_DIR = "data";

export async function readJson(name, fallback) {
  try {
    const raw = await readFile(`${DATA_DIR}/${name}`, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(name, value) {
  await writeFile(
    `${DATA_DIR}/${name}`,
    JSON.stringify(value, null, 2) + "\n",
    "utf-8"
  );
}
