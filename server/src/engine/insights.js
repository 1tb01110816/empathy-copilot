// 全量数据洞察：对 138 个会话批量跑引擎，输出聚合分析 + 与数据标注的一致率
import { getAllSessions, datasetStats, TICKET_KINDS } from '../store.js';
import { sessionIntents } from './intent.js';
import { buildEmotionCurve } from './emotion.js';
import { evaluateRisk } from './risk.js';
import { groundTruth, compareToTruth } from './eval.js';
import { buildFusion } from './fusion.js';
import { resolveSceneKey } from './analyze.js';
import { getHoldoutManifest, holdoutIds } from './holdout.js';

let cache = null;

export function insights() {
  if (cache) return cache;
  const sessions = getAllSessions();
  const holdout = holdoutIds();
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
    const sceneMajor = sceneKey.split('/')[0] || '';
    const sceneExact = sceneKey === gt.topScene;
    per.push({
      id: s.id,
      buyer: s.buyer,
      sceneKey,
      sceneMajor,
      gtScene: gt.topScene,
      level: risk.level,
      gtLevel: gt.level,
      peak: emotion.peak?.value ?? 0,
      current: emotion.current?.value ?? 0,
      switched: intent.switched,
      demo: !!s.demo,
      holdout: holdout.has(s.id),
      sceneExact,
      sceneMajorOk: sceneExact || sameMajor(sceneMajor, gt.topScene),
      evalPass: ev.pass,
      strictPass: sceneExact && ev.checks[1].ok && ev.checks[2].ok,
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

  const holdoutPer = per.filter((p) => p.holdout);
  const devPer = per.filter((p) => !p.holdout);
  const manifest = getHoldoutManifest();
  return (cache = {
    stats: datasetStats(),
    llmNote: '洞察由规则引擎批量计算；同时展示留出集与内测集一致率，严格指标不做场景等价归并',
    riskCount,
    business: buildBusiness(sessions, riskCount),
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
    agreement: agreementOf(per),
    holdoutAgreement: agreementOf(holdoutPer),
    devAgreement: agreementOf(devPer),
    split: {
      method: manifest.method,
      seed: manifest.seed,
      ratio: manifest.ratio,
      total: per.length,
      holdoutCount: holdoutPer.length,
      devCount: devPer.length,
      holdoutIds: manifest.holdout,
    },
    mismatches: per.filter((p) => !p.evalPass),
    strictMismatches: per.filter((p) => !p.strictPass),
    perSession: per,
  });
}

function agreementOf(list) {
  const rate = (key) => (list.length ? list.filter((p) => p[key]).length / list.length : 0);
  return {
    sceneStrict: rate('sceneExact'),
    scene: rate('sceneOk'),
    sceneMajor: rate('sceneMajorOk'),
    level: rate('levelOk'),
    actions: rate('actionOk'),
    strictOverall: rate('strictPass'),
    overall: rate('evalPass'),
  };
}

// —— 业务价值代理指标：全部来自 138 条 MOCK 对话的时间戳、轮次、情绪与买家画像 ——
// 口径说明：首响=买家首条消息→客服首条回复；情绪缓和=峰值≥45 且末条较峰值下降≥10；
// 正向收尾为词典代理（不等同真实 CSAT）；高风险占比复用引擎风险分级。
const POSITIVE_CLOSE = /(谢谢|感谢|辛苦|放心|满意|好评|踏实|安心|有底|靠谱|效率|挺快|贴心|爱了|解决)/;
const ts = (t) => Date.parse(String(t || '').replace(' ', 'T'));
const avgOf = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;
const p90Of = (list) => {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
};

function buildBusiness(sessions, riskCount) {
  const firstResp = [];
  const handles = [];
  const buyerMsgs = [];
  const relief = { total: 0, calm: 0 };
  const closes = { total: 0, positive: 0 };
  const drops = [];
  let repeatSessions = 0;
  let imageSessions = 0;

  for (const s of sessions) {
    const buyers = s.messages.filter((m) => m.isBuyer && !m.isSystem);
    const agents = s.messages.filter((m) => !m.isBuyer && !m.isSystem);
    buyerMsgs.push(buyers.length);
    if (s.stats?.images > 0) imageSessions += 1;

    if (buyers.length) {
      closes.total += 1;
      if (POSITIVE_CLOSE.test(String(buyers[buyers.length - 1].text || ''))) closes.positive += 1;
    }
    const firstBuyer = buyers[0];
    if (firstBuyer) {
      const t0 = ts(firstBuyer.time);
      const reply = agents.find((m) => ts(m.time) >= t0);
      if (Number.isFinite(t0) && reply) {
        const dt = (ts(reply.time) - t0) / 1000;
        if (dt >= 0) firstResp.push(dt);
      }
    }

    const start = ts(s.startTime);
    const end = ts(s.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) handles.push((end - start) / 60000);

    const curve = buildEmotionCurve(s.messages);
    const peak = curve.peak?.value ?? 0;
    drops.push(Math.max(0, peak - (curve.current?.value ?? 0)));
    if (peak >= 45) {
      relief.total += 1;
      if ((curve.current?.value ?? 0) <= peak - 10) relief.calm += 1;
    }
    if ((buildFusion(s).buyer?.visits ?? 0) > 1) repeatSessions += 1;
  }

  const total = sessions.length || 0;
  return {
    sample: total,
    firstResponse: {
      avgSec: round1(avgOf(firstResp)),
      p90Sec: round1(p90Of(firstResp)),
      slaSec: 60,
      slaRate: firstResp.length ? firstResp.filter((x) => x <= 60).length / firstResp.length : 0,
      samples: firstResp.length,
    },
    handle: {
      avgMin: round1(avgOf(handles)),
      p90Min: round1(p90Of(handles)),
      samples: handles.length,
    },
    engagement: {
      buyerMsgsAvg: round1(avgOf(buyerMsgs)),
      buyerMsgsSamples: buyerMsgs.length,
      imageSessionRate: total ? imageSessions / total : 0,
    },
    repeatSessionRate: total ? repeatSessions / total : 0,
    highRiskRate: total ? riskCount.red / total : 0,
    emotionRelief: {
      rate: relief.total ? relief.calm / relief.total : 0,
      total: relief.total,
      calm: relief.calm,
      avgDrop: round1(avgOf(drops)),
    },
    positiveClose: {
      rate: closes.total ? closes.positive / closes.total : 0,
      total: closes.total,
      positive: closes.positive,
    },
  };
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
