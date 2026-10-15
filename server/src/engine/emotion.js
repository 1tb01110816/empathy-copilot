import { matchByPriority } from './lexicon.js';

// 权重与阈值集中在此，便于校准
export const W = {
  base: 22,
  strong: { unit: 18, cap: 48 },
  threat: { unit: 12, cap: 24 },
  churn: { unit: 10, cap: 20 },
  med: { unit: 7, cap: 21 },
  health: { unit: 6, cap: 18 },
  mild: { unit: 3.5, cap: 14 },
  resigned: { unit: -5, cap: -10 },
  pos: { unit: -7, cap: -21 },
  intensifier: { unit: 4, cap: 8 },
  exclaim: { unit: 3, cap: 9 },
  question: { unit: 1.5, cap: 6 },
  ema: 0.65,
  turnDelta: 9,
  labels: [
    [15, '满意/情绪良好'], [30, '平静'], [45, '轻度疑虑'], [62, '明显不满/焦虑'], [82, '强烈不满'], [101, '激烈冲突'],
  ],
};

import { LEXICON } from './lexicon.js';
const defiant = LEXICON.defiant || [];

export function stateOf(v) {
  if (v == null) return '未知';
  for (const [limit, label] of W.labels) if (v < limit) return label;
  return '激烈冲突';
}

export function scoreText(text) {
  const t = String(text || '');
  const hits = matchByPriority(t, ['strong', 'threat', 'churn', 'med', 'health', 'resigned', 'pos', 'mild']);
  // 对峙类措辞（随便你们/你们等着/反正…）——归入冲突信号
  const defHits = [];
  for (const w of defiant) {
    if (t.includes(w) && !hits.med?.includes(w)) defHits.push(w);
  }
  const cap = (n, { unit, cap }) => (unit >= 0 ? Math.min(cap, n * unit) : Math.max(cap, n * unit));
  let score = W.base;
  score += cap(hits.strong?.length || 0, W.strong);
  score += cap(hits.threat?.length || 0, W.threat);
  score += cap(hits.churn?.length || 0, W.churn);
  score += cap(hits.med?.length || 0, W.med);
  score += cap(hits.health?.length || 0, W.health);
  score += cap(hits.resigned?.length || 0, W.resigned);
  score += cap(hits.pos?.length || 0, W.pos);
  score += cap(hits.mild?.length || 0, W.mild);
  score += cap(defHits.length, { unit: 9, cap: 18 });

  const negCount =
    (hits.strong?.length || 0) + (hits.threat?.length || 0) + (hits.churn?.length || 0) +
    (hits.med?.length || 0) + (hits.mild?.length || 0) + defHits.length;
  const intens = matchByPriority(t, ['intensifier']).intensifier || [];
  if (intens.length && negCount > 0) score += cap(intens.length, W.intensifier);
  const excl = (t.match(/[!！]/g) || []).length;
  if (excl) score += cap(excl, W.exclaim);
  const q = (t.match(/[?？]/g) || []).length;
  if (q >= 2) score += cap(q, W.question);

  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const topHits = [
    ...(hits.strong || []), ...(hits.threat || []), ...defHits,
    ...(hits.churn || []), ...(hits.med || []), ...(hits.health || []), ...(hits.mild || []),
  ];
  return { score, hits: topHits };
}

export function buildEmotionCurve(messages, uptoSeq = Infinity) {
  const points = [];
  let ema = null;
  for (const m of messages) {
    if (m.seq > uptoSeq || !m.isBuyer) continue;
    const { score, hits } = scoreText(m.text);
    ema = ema === null ? score : ema * (1 - W.ema) + score * W.ema;
    points.push({
      seq: m.seq,
      raw: score,
      value: Math.round(ema * 10) / 10,
      time: m.time,
      snippet: m.text.slice(0, 48),
      hits: hits.slice(0, 4),
    });
  }
  const turns = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].value - points[i - 1].value;
    if (d >= W.turnDelta) turns.push({ seq: points[i].seq, dir: 'up', delta: Math.round(d * 10) / 10 });
    else if (d <= -W.turnDelta) turns.push({ seq: points[i].seq, dir: 'down', delta: Math.round(d * 10) / 10 });
  }
  const peak = points.reduce((a, p) => (!a || p.value > a.value ? p : a), null);
  const current = points.length ? points[points.length - 1] : null;
  return {
    points, turns, peak,
    current,
    state: current ? stateOf(current.value) : '未知',
    trend: points.length >= 2 ? Math.round((points[points.length - 1].value - points[points.length - 2].value) * 10) / 10 : 0,
  };
}

// LLM 逐条打分与规则曲线融合（LLM 权重默认 0.55）
export function blendCurves(ruleCurve, llmScores, weight = 0.55) {
  if (!llmScores?.length) return ruleCurve;
  const bySeq = new Map(llmScores.map((s) => [s.seq, s.score]));
  let ema = null;
  const points = ruleCurve.points.map((p) => {
    const llm = bySeq.get(p.seq);
    const raw = llm == null ? p.raw : Math.round((p.raw * (1 - weight) + llm * weight) * 10) / 10;
    ema = ema === null ? raw : ema * (1 - W.ema) + raw * W.ema;
    return { ...p, raw, value: Math.round(ema * 10) / 10, llm };
  });
  const turns = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].value - points[i - 1].value;
    if (d >= W.turnDelta) turns.push({ seq: points[i].seq, dir: 'up', delta: Math.round(d * 10) / 10 });
    else if (d <= -W.turnDelta) turns.push({ seq: points[i].seq, dir: 'down', delta: Math.round(d * 10) / 10 });
  }
  const peak = points.reduce((a, p) => (!a || p.value > a.value ? p : a), null);
  const current = points.length ? points[points.length - 1] : null;
  return {
    points, turns, peak,
    current,
    state: current ? stateOf(current.value) : '未知',
    trend: points.length >= 2 ? Math.round((points[points.length - 1].value - points[points.length - 2].value) * 10) / 10 : 0,
  };
}
