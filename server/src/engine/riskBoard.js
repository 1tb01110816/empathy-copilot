// 跨会话风险预警：只读聚合 138 条赛题会话，输出「一会话一条」的预警队列。
// 状态跟踪由 riskState.js 独立持久化，不改动原始聊天/订单/工单与对账口径。
import { getAllSessions } from '../store.js';
import { insights } from './insights.js';
import { buildEmotionCurve } from './emotion.js';
import { playbookFor, A } from './risk.js';

export const RISK_SIGNAL_META = [
  {
    key: 'complaint',
    label: '舆情投诉',
    tone: 'rose',
    desc: '买家明确表达投诉、举报、平台介入或 12315/315 等升级意向',
  },
  {
    key: 'repeatVisit',
    label: '重复进线',
    tone: 'sky',
    desc: '同一买家累计接待 ≥3 次，反复沟通易升级流失',
  },
  {
    key: 'emotion',
    label: '情绪升级',
    tone: 'amber',
    desc: '会话情绪峰值 ≥55，达到明显不满/焦虑区间',
  },
  {
    key: 'repeatRefund',
    label: '重复退款',
    tone: 'violet',
    desc: '同一买家累计退款类工单（线下打款/售后退货）≥2 张',
  },
];

const SIGNAL_BY_KEY = new Map(RISK_SIGNAL_META.map((s) => [s.key, s]));

// 威胁词：12315/315 需避免命中订单号、手机号等长数字串
const THREAT_RE = /(投诉|差评|曝光|举报|12315|12345|(?<!\d)315(?!\d)|平台介入|平台申请|维权|工商|消协)/g;
// 否定式（「就不投诉了」「别举报」）不算真实升级意向；「不然我投诉」中的「不然」不是否定
const NEGATION_RE = /(?:不(?!然)|别|没|无需|不用|不会|懒得)[^，。！？!?]{0,6}$/;

const clip = (text, max = 64) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

function scanThreats(messages) {
  const hits = [];
  for (const m of messages) {
    if (!m.isBuyer) continue;
    const text = String(m.text || '');
    const re = new RegExp(THREAT_RE.source, 'g');
    let match;
    while ((match = re.exec(text))) {
      const before = text.slice(Math.max(0, match.index - 10), match.index);
      if (NEGATION_RE.test(before)) continue;
      hits.push({ word: match[0], seq: m.seq, time: m.time, text: clip(text) });
      break;
    }
  }
  return hits;
}

function refundReason(t) {
  if (t.kind === 'payoff') return t['退款问题类型'] || '';
  return t['退货原因'] || '';
}

function ticketStatus(t) {
  return t['工单状态'] || t['任务状态'] || '';
}

function buildBuyerIndex(sessions) {
  const map = new Map();
  for (const s of sessions) {
    let entry = map.get(s.buyer);
    if (!entry) {
      entry = { sessionIds: [], tickets: [] };
      map.set(s.buyer, entry);
    }
    entry.sessionIds.push(s.id);
    for (const t of s.tickets) entry.tickets.push(t);
  }
  return map;
}

function severityOf({ riskLevel, signals }) {
  const urgent = riskLevel === 'red' || signals.some((s) => s.key === 'complaint');
  if (urgent) return 'urgent';
  if (signals.length >= 2) return 'high';
  return 'medium';
}

function suggestedActionsFor({ sceneKey, signals }) {
  const major = String(sceneKey || '').split('/')[0];
  const book = playbookFor(sceneKey, major);
  const preferred = [];
  if (signals.some((s) => s.key === 'complaint')) preferred.push(A.empathyFirst, A.ruleExplain);
  if (signals.some((s) => s.key === 'repeatVisit')) preferred.push(A.verifyPrior, A.empathyFirst);
  if (signals.some((s) => s.key === 'emotion')) preferred.push(A.empathyFirst);
  if (signals.some((s) => s.key === 'repeatRefund')) preferred.push(A.refundAudit, A.etaCommit);
  const seen = new Set();
  const out = [];
  for (const action of [...preferred, ...book.actions]) {
    if (seen.has(action.code)) continue;
    seen.add(action.code);
    out.push({ code: action.code, label: action.label });
    if (out.length >= 5) break;
  }
  return out;
}

export function buildRiskBoard() {
  const sessions = getAllSessions();
  const ins = insights();
  const per = new Map(ins.perSession.map((p) => [p.id, p]));
  const buyerIndex = buildBuyerIndex(sessions);

  const alerts = [];
  for (const session of sessions) {
    const info = per.get(session.id);
    if (!info) continue;
    const curve = buildEmotionCurve(session.messages);
    const peak = Math.round((curve.peak?.value ?? 0) * 10) / 10;
    const current = Math.round((curve.current?.value ?? 0) * 10) / 10;
    const buyer = buyerIndex.get(session.buyer) || { sessionIds: [session.id], tickets: [] };
    const visits = buyer.sessionIds.length;
    const priorTickets = buyer.tickets.filter((t) => t['会话ID'] !== session.id).length;
    const refundTickets = buyer.tickets
      .filter((t) => t.kind === 'payoff' || t.kind === 'return')
      .sort((a, b) => String(b['创建时间'] || '').localeCompare(String(a['创建时间'] || '')));

    const threats = scanThreats(session.messages);
    const signals = [];

    if (threats.length) {
      signals.push({
        ...SIGNAL_BY_KEY.get('complaint'),
        detail: `出现「${threats[0].word}」等升级措辞 ${threats.length} 处`,
        evidence: threats.slice(0, 2).map((h) => ({ time: h.time, text: h.text })),
      });
    }
    if (visits >= 3) {
      const priorSessionIds = buyer.sessionIds.filter((id) => id !== session.id).slice(0, 3);
      signals.push({
        ...SIGNAL_BY_KEY.get('repeatVisit'),
        detail: `累计接待 ${visits} 次 · 历史工单 ${priorTickets} 张`,
        evidence: [
          {
            time: '',
            text: `历史会话 ${priorSessionIds.join('、')}${buyer.sessionIds.length > priorSessionIds.length + 1 ? ' 等' : ''}`,
          },
        ],
      });
    }
    if (peak >= 55) {
      signals.push({
        ...SIGNAL_BY_KEY.get('emotion'),
        detail: `情绪峰值 ${peak} · 末值 ${current} · ${curve.state}`,
        evidence: curve.peak
          ? [{ time: curve.peak.time, text: clip(curve.peak.snippet) }]
          : [],
      });
    }
    if (refundTickets.length >= 2) {
      signals.push({
        ...SIGNAL_BY_KEY.get('repeatRefund'),
        detail: `累计退款类工单 ${refundTickets.length} 张（含本会话）`,
        evidence: refundTickets.slice(0, 2).map((t) => ({
          time: t['创建时间'] || '',
          text: `${t.kindLabel || ''} ${t['工单号']} · ${refundReason(t) || '退款诉求'} · ${ticketStatus(t) || '处理中'}${
            t['会话ID'] === session.id ? '（本会话）' : ''
          }`,
        })),
      });
    }

    if (!signals.length) continue;

    const severity = severityOf({ riskLevel: info.level, signals });
    alerts.push({
      id: `RA-${session.id}`,
      sessionId: session.id,
      buyer: session.buyer,
      sceneKey: info.sceneKey || session.sceneKey,
      startTime: session.startTime,
      riskLevel: info.level,
      severity,
      peak,
      current,
      visits,
      priorTickets,
      refundTickets: refundTickets.length,
      signals,
      suggestedActions: suggestedActionsFor({ sceneKey: info.sceneKey, signals }),
      status: 'pending',
      owner: '',
      note: '',
      updatedAt: '',
    });
  }

  const rank = { urgent: 0, high: 1, medium: 2 };
  alerts.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      b.signals.length - a.signals.length ||
      b.peak - a.peak ||
      String(b.startTime).localeCompare(String(a.startTime)),
  );

  const countSignal = (key) => alerts.filter((a) => a.signals.some((s) => s.key === key)).length;
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      sessions: sessions.length,
      total: alerts.length,
      urgent: alerts.filter((a) => a.severity === 'urgent').length,
      high: alerts.filter((a) => a.severity === 'high').length,
      medium: alerts.filter((a) => a.severity === 'medium').length,
      complaints: countSignal('complaint'),
      repeatVisits: countSignal('repeatVisit'),
      emotions: countSignal('emotion'),
      repeatRefunds: countSignal('repeatRefund'),
      byStatus: {
        pending: alerts.length,
        following: 0,
        closed: 0,
      },
    },
    signals: RISK_SIGNAL_META,
    alerts,
  };
}
