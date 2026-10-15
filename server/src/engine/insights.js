// 全量数据洞察：对 138 个会话批量跑引擎，输出聚合分析 + 与数据标注的一致率
import { getAllSessions, datasetStats, TICKET_KINDS } from '../store.js';
import { sessionIntents } from './intent.js';
import { buildEmotionCurve } from './emotion.js';
import { evaluateRisk } from './risk.js';
import { groundTruth, compareToTruth } from './eval.js';
import { buildFusion } from './fusion.js';
import { resolveSceneKey } from './analyze.js';

let cache = null;

export function insights() {
  if (cache) return cache;
  const sessions = getAllSessions();
  const per = [];
  const ticketCounter = new Map();
  for (const s of sessions) {
    const intent = sessionIntents(s.messages);
    const emotion = buildEmotionCurve(s.messages);
    const top = intent.dominant[0];
    const sceneKey = resolveSceneKey(intent, s, s.messages);
    const fusion = buildFusion(s);
    const risk = evaluateRisk({ sceneKey, major: sceneKey.split('/')[0], emotion, session: s, fusion });
    const gt = groundTruth(s);
    const ev = compareToTruth({ intent, risk, sceneKey }, gt);
    per.push({
      id: s.id,
      buyer: s.buyer,
      sceneKey,
      sceneMajor: sceneKey.split('/')[0] || '',
      gtScene: gt.topScene,
      level: risk.level,
      gtLevel: gt.level,
      peak: emotion.peak?.value ?? 0,
      current: emotion.current?.value ?? 0,
      switched: intent.switched,
      demo: !!s.demo,
      evalPass: ev.pass,
      sceneOk: ev.checks[0].ok,
      levelOk: ev.checks[1].ok,
      actionOk: ev.checks[2].ok,
      missing: ev.missing,
      msgs: s.stats.msgs,
      ticketKinds: s.tickets.map((t) => t.kind),
      topReason: risk.reasons[0] || '',
    });
    for (const t of s.tickets) {
      const reason = t['退货原因'] || t['售后原因'] || t['退款问题类型'] || t['问题类型'] || t['症状描述'] || '其他';
      const key = `${t.kindLabel}|${reason}`;
      ticketCounter.set(key, (ticketCounter.get(key) || 0) + 1);
    }
  }

  const riskCount = { red: 0, yellow: 0, green: 0 };
  for (const p of per) riskCount[p.level] += 1;

  // 数据标注口径的场景分布（消息数）
  const sceneDist = new Map();
  for (const s of sessions) {
    for (const m of s.messages) {
      if (!m.sceneMajor) continue;
      const key = `${m.sceneMajor}/${m.sceneMinor}`;
      sceneDist.set(key, (sceneDist.get(key) || 0) + 1);
    }
  }

  const n = per.length || 1;
  return (cache = {
    stats: datasetStats(),
    llmNote: '洞察由规则引擎批量计算，展示与数据标注的一致率',
    riskCount,
    riskSessions: {
      red: per.filter((p) => p.level === 'red').map(pick),
      yellow: per.filter((p) => p.level === 'yellow').map(pick),
    },
    topUpset: [...per].sort((a, b) => b.peak - a.peak).slice(0, 8).map(pick),
    sceneDistribution: [...sceneDist.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    ticketHotspots: [...ticketCounter.entries()]
      .map(([key, count]) => {
        const [kind, reason] = key.split('|');
        return { kind, reason, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    agreement: {
      scene: per.filter((p) => p.sceneOk).length / n,
      sceneMajor: per.filter((p) => sameMajor(p.sceneMajor, p.gtScene) || p.sceneOk).length / n,
      level: per.filter((p) => p.levelOk).length / n,
      actions: per.filter((p) => p.actionOk).length / n,
      overall: per.filter((p) => p.evalPass).length / n,
    },
    mismatches: per.filter((p) => !p.evalPass),
    perSession: per,
  });
}

function sameMajor(a, b) {
  if (!a || !b) return false;
  return a === b.split('/')[0];
}

function pick(p) {
  return {
    id: p.id, buyer: p.buyer, sceneKey: p.sceneKey, level: p.level,
    peak: p.peak, msgs: p.msgs, demo: p.demo, topReason: p.topReason,
  };
}
