// 引擎校准脚本：node scripts/engine-check.js [会话ID...]
import { getSession, getAllSessions, initStore } from '../src/store.js';
import { ruleAnalyze } from '../src/engine/analyze.js';
import { insights } from '../src/engine/insights.js';
import { closeDb } from '../src/db.js';

await initStore();

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['S00010', 'S00003', 'S00024'];

for (const id of ids) {
  const s = getSession(id);
  if (!s) {
    console.log(`${id}: not found`);
    continue;
  }
  const a = ruleAnalyze(s);
  console.log(`\n════════ ${id} · ${s.buyer} ════════`);
  console.log('摘要 :', a.summary);
  console.log('意图 :', a.intent.dominant.map((d) => `${d.major}/${d.minor}×${d.count}`).join(' | ') || '未识别');
  console.log('曲线 :', a.emotion.points.map((p) => `#${p.seq}:${p.raw}→${p.value}`).join('  '));
  console.log('峰值 :', a.emotion.peak?.value, '| 状态:', a.emotion.state, '| 拐点:', JSON.stringify(a.emotion.turns));
  console.log('风险 :', a.risk.level.toUpperCase(), '|', a.risk.reasons.join('；'));
  console.log('动作 :', a.risk.actions.map((x) => x.code).join(', '));
  console.log('对账 :', a.evaluation.summary, '|', a.evaluation.checks.map((c) => `${c.label}:${c.ok ? '✓' : '✗'}(${c.detail})`).join('  '));
  console.log('话术 :', a.reply.slice(0, 70) + '…');
}

if (process.argv.includes('--all')) {
  const ins = insights();
  console.log('\n════════ 全量洞察 ════════');
  console.log('风险分布:', JSON.stringify(ins.riskCount));
  console.log('一致率  :', JSON.stringify(Object.fromEntries(Object.entries(ins.agreement).map(([k, v]) => [k, Math.round(v * 100) + '%']))));
  console.log('高风险会话:', ins.riskSessions.red.slice(0, 6).map((p) => `${p.id}:${p.sceneKey}(${p.peak})`).join(' | '));
  const missed = ins.perSession.filter((p) => !p.evalPass).slice(0, 10);
  console.log('未对齐 Top10:', missed.map((p) => `${p.id}(scene:${p.sceneOk ? '✓' : '✗'},level:${p.levelOk ? '✓' : '✗'},${p.sceneKey})`).join(' '));
  console.log('会话总数:', getAllSessions().length);
}

await closeDb();
