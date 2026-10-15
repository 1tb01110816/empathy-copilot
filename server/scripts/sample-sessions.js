// 校准辅助：打印指定会话的买家消息 + 引擎判定 vs 数据标注（用法：node scripts/sample-sessions.js S00004 S00005 ... / --mismatch）
import { getSession, getAllSessions, initStore } from '../src/store.js';
import { sessionIntents } from '../src/engine/intent.js';
import { buildEmotionCurve } from '../src/engine/emotion.js';
import { evaluateRisk } from '../src/engine/risk.js';
import { groundTruth, compareToTruth } from '../src/engine/eval.js';
import { buildFusion } from '../src/engine/fusion.js';
import { resolveSceneKey } from '../src/engine/analyze.js';
import { closeDb } from '../src/db.js';

await initStore();

const args = process.argv.slice(2);
const wantMismatch = args.includes('--mismatch');

const ids = wantMismatch
  ? getAllSessions().filter((s) => {
      const intent = sessionIntents(s.messages);
      const emotion = buildEmotionCurve(s.messages);
      const sceneKey = resolveSceneKey(intent, s, s.messages);
      const risk = evaluateRisk({ sceneKey, major: sceneKey.split('/')[0], emotion, session: s, fusion: buildFusion(s) });
      return !compareToTruth({ intent, risk, sceneKey }, groundTruth(s)).pass;
    }).map((s) => s.id)
  : args;

for (const id of ids) {
  const s = getSession(id);
  if (!s) {
    console.log(`\n=== ${id} not found ===`);
    continue;
  }
  const intent = sessionIntents(s.messages);
  const emotion = buildEmotionCurve(s.messages);
  const sceneKey = resolveSceneKey(intent, s, s.messages);
  const risk = evaluateRisk({ sceneKey, major: sceneKey.split('/')[0], emotion, session: s, fusion: buildFusion(s) });
  const gt = groundTruth(s);
  const ev = compareToTruth({ intent, risk, sceneKey }, gt);
  console.log(`\n=== ${id} ${s.buyer} | 引擎 ${sceneKey}(${risk.level}) ↔ 标注 ${gt.topScene}(${gt.level}) | ${ev.summary} ${ev.pass ? '✓' : '✗'}`);
  if (!ev.checks[2].ok) console.log(`    missing: ${ev.missing.join(', ')}`);
  for (const m of s.messages) {
    const who = m.isBuyer ? '买' : '客';
    if (m.sceneMinor) console.log(`  [#${m.seq} ${who}][${m.sceneMajor}/${m.sceneMinor}] ${m.text.slice(0, 80)}`);
    else console.log(`  [#${m.seq} ${who}] ${m.text.slice(0, 80)}`);
  }
}

await closeDb();
