// 验收对账：系统输出 vs 赛题数据中的真实处理结果

// 场景等价组（引擎语义分类与数据标注口径的桥接）
const SCENE_EQUIV = [
  ['订单服务/保价申请被拒', '退款打款/大促价保补差'],
  ['补发换货/漏发赠品', '补发换货/会员权益加赠补发', '订单服务/直播间承诺纠纷'],
  ['不良反应/泛红刺痒', '不良反应/闷痘爆痘', '不良反应/过敏就医', '售后退货/使用不适退货'],
  ['物流异常/包裹破损', '补发换货/破损换货'],
];

function sameFamily(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return SCENE_EQUIV.some((group) => group.includes(a) && group.includes(b));
}

const TICKET_GOLDEN_ACTIONS = {
  adverse: ['register_adverse', 'callback_24h', 'stop_use'],
  reship: ['reship_create'],
  logistics: ['express_check'],
  payoff: ['refund_audit'],
  return: ['refund_audit'],
};

export function groundTruth(session) {
  // 试跑会话：现场输入无赛题标注，跳过对账
  if (session.tryMode) {
    return { tryMode: true, goldenScenes: [], topScene: '', tickets: [], outcomes: [], level: '', expectedActions: [] };
  }
  const goldenScenes = session.scenes.map((s) => `${s.major}/${s.minor}`);
  const agentTexts = session.messages.filter((m) => m.role === '客服').map((m) => m.text).join('\n');

  const outcomes = [];
  if (/券已发放|无门槛券.*(发放|给|补)/.test(agentTexts)) {
    outcomes.push({ code: 'coupon_50', label: '发放无门槛券补偿（数据中 ¥50）', evidence: '客服消息确认券已发放' });
  }
  if (/打款申请已提交|支付宝打款|线下打款/.test(agentTexts)) {
    outcomes.push({ code: 'offline_pay', label: '线下支付宝打款', evidence: '客服消息确认打款流程' });
  }
  if (/专员.*回访|24小时.*回访|24 小时/.test(agentTexts)) {
    outcomes.push({ code: 'callback_24h', label: '承诺专员 24 小时回访', evidence: '客服消息中的确定性承诺' });
  }
  if (/转风控|风控核实|核实出库|称重/.test(agentTexts)) {
    outcomes.push({ code: 'risk_check', label: '转风控核实（空包裹）', evidence: '客服消息中的风控核实流程' });
  }

  const goldenTicketActions = [];
  for (const t of session.tickets) {
    if (t.kind === 'return' && String(t['退货原因']).includes('空包裹')) {
      goldenTicketActions.push('risk_check', 'keep_evidence', 'verify_weight');
    } else if (t.kind === 'return') {
      goldenTicketActions.push('refund_audit');
    } else if (t.kind === 'payoff') {
      const type = String(t['退款问题类型']);
      goldenTicketActions.push(type.includes('价保') ? 'offline_pay' : 'refund_audit');
    } else {
      goldenTicketActions.push(...(TICKET_GOLDEN_ACTIONS[t.kind] || []));
    }
  }

  let level = 'green';
  if (session.tickets.some((t) => t.kind === 'adverse')) level = 'red';
  if (session.tickets.some((t) => t.kind === 'return' && String(t['退货原因']).includes('空包裹'))) level = 'red';
  if (level === 'green' && (session.tickets.length > 0 || outcomes.some((o) => o.code === 'coupon_50' || o.code === 'offline_pay'))) {
    level = 'yellow';
  }

  return {
    goldenScenes,
    topScene: goldenScenes[0] || '',
    tickets: session.tickets.map((t) => ({
      kindLabel: t.kindLabel,
      id: t['工单号'],
      reason: t['退货原因'] || t['售后原因'] || t['退款问题类型'] || t['问题类型'] || t['症状描述'] || '',
      status: t['工单状态'] || t['任务状态'],
      extra: t['签收建议'] || t['处理方案'] || '',
    })),
    outcomes,
    level,
    expectedActions: [...new Set([...goldenTicketActions, ...outcomes.map((o) => o.code)])],
  };
}

export function compareToTruth(analysis, gt) {
  if (gt?.tryMode) {
    return { tryMode: true, checks: [], matched: [], missing: [], pass: null, summary: '试跑会话 · 无数据标注，跳过对账' };
  }
  const engineScene = analysis.sceneKey || (analysis.intent?.dominant?.[0]
    ? `${analysis.intent.dominant[0].major}/${analysis.intent.dominant[0].minor}`
    : '');
  const sceneOk = sameFamily(engineScene, gt.topScene) || gt.goldenScenes.some((g) => sameFamily(engineScene, g));

  const levelOk = analysis.risk.level === gt.level;

  const engineCodes = new Set(analysis.risk.actions.map((a) => a.code));
  const matched = gt.expectedActions.filter((c) => engineCodes.has(c));
  const missing = gt.expectedActions.filter((c) => !engineCodes.has(c));
  const actionsOk = missing.length === 0;

  const checks = [
    { id: 'scene', label: '场景判定', ok: sceneOk, detail: `引擎 ${engineScene || '未识别'} ↔ 数据标注 ${gt.topScene}` },
    { id: 'level', label: '风险等级', ok: levelOk, detail: `引擎 ${analysis.risk.level} ↔ 真实处理强度 ${gt.level}` },
    { id: 'actions', label: '建议动作覆盖', ok: actionsOk, detail: actionsOk ? `命中 ${matched.length} 项关键动作` : `缺失 ${missing.join('、')}` },
  ];
  return {
    checks,
    matched,
    missing,
    pass: checks.every((c) => c.ok),
    summary: `${checks.filter((c) => c.ok).length}/${checks.length} 项与真实处理口径一致`,
  };
}
