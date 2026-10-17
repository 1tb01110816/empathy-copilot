// 生成确定性分层留出集：node scripts/build-holdout.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, getAllSessions } from '../src/store.js';
import { groundTruth } from '../src/engine/eval.js';
import { closeDb } from '../src/db.js';

const SEED = 'empathy-copilot-holdout-v1';
const RATIO = 0.3;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'holdout.json');

await initStore();

const grouped = new Map();
for (const s of getAllSessions()) {
  const major = groundTruth(s).topScene.split('/')[0] || '未知';
  if (!grouped.has(major)) grouped.set(major, []);
  grouped.get(major).push(s.id);
}

const hash = (id) => crypto.createHash('sha256').update(`${SEED}:${id}`).digest('hex');
const holdout = [];
const strata = {};
for (const [major, ids] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh'))) {
  ids.sort((a, b) => hash(a).localeCompare(hash(b)));
  const k = Math.max(1, Math.round(ids.length * RATIO));
  holdout.push(...ids.slice(0, k));
  strata[major] = { total: ids.length, holdout: k };
}

holdout.sort();
const total = getAllSessions().length;
const manifest = {
  method: 'stratified-sha256',
  seed: SEED,
  ratio: RATIO,
  generatedAt: new Date().toISOString().slice(0, 10),
  total,
  holdoutCount: holdout.length,
  devCount: total - holdout.length,
  strata,
  holdout,
};
fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`留出集已生成：${holdout.length}/${total} → ${OUT}`);
console.log(JSON.stringify(strata, null, 2));

await closeDb();
