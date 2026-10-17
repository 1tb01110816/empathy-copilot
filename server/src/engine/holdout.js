import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'holdout.json');

let manifest = null;
let ids = null;

export function getHoldoutManifest() {
  if (!manifest) manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return manifest;
}

export function holdoutIds() {
  if (!ids) ids = new Set(getHoldoutManifest().holdout);
  return ids;
}
