import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHoldoutManifest, holdoutIds } from '../src/engine/holdout.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const manifest = getHoldoutManifest();

function datasetSessionIds() {
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, 'chat.json'), 'utf8'));
  const [header, ...body] = rows;
  const idx = header.indexOf('会话ID');
  return new Set(body.filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => r[idx]));
}

test('留出集清单：42 / 138，与全量无交集且完整覆盖', () => {
  const all = datasetSessionIds();
  const holdout = new Set(manifest.holdout);
  assert.equal(manifest.total, 138);
  assert.equal(manifest.holdoutCount, 42);
  assert.equal(manifest.devCount, 96);
  assert.equal(holdout.size, manifest.holdout.length, '留出集不应有重复会话');
  assert.equal(all.size, 138);
  for (const id of holdout) assert.ok(all.has(id), `未知会话 ${id}`);
  assert.equal(manifest.holdoutCount + manifest.devCount, all.size);
});

test('留出集清单：分层数量与 30% 比例一致', () => {
  const strata = Object.values(manifest.strata);
  assert.equal(strata.reduce((n, s) => n + s.total, 0), manifest.total);
  assert.equal(strata.reduce((n, s) => n + s.holdout, 0), manifest.holdoutCount);
  for (const s of strata) {
    assert.equal(s.holdout, Math.max(1, Math.round(s.total * manifest.ratio)));
    assert.ok(s.holdout < s.total, '每个分层都应保留内测样本');
  }
});

test('holdoutIds：按清单返回集合', () => {
  const ids = holdoutIds();
  assert.equal(ids.size, manifest.holdoutCount);
  assert.ok(ids.has(manifest.holdout[0]));
  assert.ok(!ids.has('__not_a_session__'));
});
