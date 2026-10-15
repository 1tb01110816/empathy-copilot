// 风险分级与动作库：红（健康/高冲突）/ 黄（不满/流失）/ 绿（常规）
// references: 提案表4 风险分级定义 + 数据中真实处理结果

export const A = {
  stopUse: { code: 'stop_use', label: '立即停用提醒', kind: 'guide' },
  gentleCare: { code: 'gentle_care', label: '清水洁面+保湿指导', kind: 'guide' },
  registerAdverse: { code: 'register_adverse', label: '登记不良反应单（脱敏）', kind: 'ticket' },
  callback24h: { code: 'callback_24h', label: '24小时专员回访', kind: 'followup' },
  medicalGuide: { code: 'medical_guide', label: '就医指引（不做诊断/用药建议）', kind: 'guide' },
  returnUnsuitable: { code: 'return_unsuitable', label: '使用不适退货（运费店铺承担）', kind: 'refund' },
  keepEvidence: { code: 'keep_evidence', label: '留存外箱六面+面单照片', kind: 'guide' },
  verifyWeight: { code: 'verify_weight', label: '核验出库称重记录', kind: 'internal' },
  riskCheck: { code: 'risk_check', label: '转风控核实', kind: 'ticket' },
  compliantEvidence: { code: 'compliant_evidence', label: '合规举证话术', kind: 'script' },
  ruleExplain: { code: 'rule_explain', label: '平台规则说明', kind: 'script' },
  coupon50: { code: 'coupon_50', label: '申请50元无门槛券补偿', kind: 'coupon' },
  couponCustom: { code: 'coupon_custom', label: '申请无门槛券补偿', kind: 'coupon' },
  priceProtectCheck: { code: 'price_protect_check', label: '核查价保条件（15天+店铺降价）', kind: 'internal' },
  offlinePay: { code: 'offline_pay', label: '线下支付宝打款差额', kind: 'refund' },
  etaCommit: { code: 'eta_commit', label: '承诺到账时效（1-3个工作日）', kind: 'script' },
  reshipCreate: { code: 'reship_create', label: '创建补发换货工单', kind: 'ticket' },
  reshipUrgent: { code: 'reship_urgent', label: '客诉加急标记', kind: 'ticket' },
  photoEvidence: { code: 'photo_evidence', label: '引导拍照留证', kind: 'guide' },
  exchangeOrReship: { code: 'exchange_or_reship', label: '换货/补发处理', kind: 'ticket' },
  freightBear: { code: 'freight_bear', label: '运费店铺承担', kind: 'script' },
  expressCheck: { code: 'express_check', label: '联系快递核实', kind: 'internal' },
  over48h: { code: 'over_48h', label: '超48小时升级处理', kind: 'internal' },
  warehouseIntercept: { code: 'warehouse_intercept', label: '仓库拦截/改址', kind: 'internal' },
  refundAudit: { code: 'refund_audit', label: '审核退款条件', kind: 'internal' },
  refundPath: { code: 'refund_path', label: '说明退款路径', kind: 'script' },
  refundPush: { code: 'refund_push', label: '催促财务/系统加速', kind: 'internal' },
  invoiceHandle: { code: 'invoice_handle', label: '发票开具处理', kind: 'internal' },
  presaleAnswer: { code: 'presale_answer', label: '预售规则解答', kind: 'script' },
  consultAnswer: { code: 'consult_answer', label: '产品知识解答', kind: 'script' },
  recommend: { code: 'recommend', label: '推荐/试色建议', kind: 'script' },
  memberOps: { code: 'member_ops', label: '会员权益操作', kind: 'internal' },
  verifyPrior: { code: 'verify_prior', label: '核对历史承诺/权益记录', kind: 'internal' },
  empathyFirst: { code: 'empathy_first', label: '先共情安抚再讲规则', kind: 'script' },
};

const P = (level, reasons, actions, compliance = [], hints = '') => ({ level, reasons, actions, compliance, hints });

// 精细场景级方案（关键场景与数据真实处理结果对齐）
export const PLAYBOOKS = {
  '不良反应/泛红刺痒': P('red', ['健康安全风险：买家自述使用后出现泛红、瘙痒等疑似不良反应'], [A.stopUse, A.gentleCare, A.registerAdverse, A.callback24h, A.returnUnsuitable, A.medicalGuide],
    ['不提供医疗诊断与用药建议', '不良反应单为脱敏登记，不收集病历原件', '若症状加重引导及时就医']),
  '不良反应/过敏就医': P('red', ['健康安全风险：已就医/需就医的疑似过敏'], [A.stopUse, A.registerAdverse, A.callback24h, A.returnUnsuitable, A.medicalGuide],
    ['不做医疗判断，仅执行停用提醒与登记回访', '协助买家留存就医相关信息需脱敏']),
  '不良反应/闷痘爆痘': P('red', ['健康安全风险：使用后出现闷痘/爆痘反馈'], [A.stopUse, A.registerAdverse, A.callback24h, A.returnUnsuitable, A.refundAudit],
    ['不做医疗诊断', '引导停用观察并登记回访']),
  '售后退货/仅退款疑似异常': P('red', ['高冲突+资损风险：仅退款/空包裹类异常，需风控核实'], [A.keepEvidence, A.verifyWeight, A.riskCheck, A.compliantEvidence],
    ['不做未经核实的前置赔付承诺', '如实举证平台，保留合规记录', '核实结果及时同步买家'], 'red-conflict'),
  '售后退货/拆封少件拒收': P('yellow', ['纠纷风险：拆封少件/拒收类争议'], [A.photoEvidence, A.refundAudit, A.empathyFirst],
    ['按照实物与记录双向核实', '避免单方面承诺赔付']),
  '售后退货/质疑正品退货': P('yellow', ['信任危机+流失风险：买家质疑正品'], [A.empathyFirst, A.refundAudit, A.exchangeOrReship],
    ['提供官方渠道与批次溯源信息', '避免对抗性表述']),
  '售后退货/使用不适退货': P('yellow', ['健康关联：使用不适退货诉求'], [A.stopUse, A.returnUnsuitable, A.refundAudit, A.callback24h],
    ['如涉及明显过敏症状，按不良反应流程登记']),
  '售后退货/色号不合适退货': P('green', ['常规售后：色号不合适'], [A.refundAudit, A.refundPath, A.freightBear]),
  '售后退货/七天无理由退货': P('green', ['常规售后：七天无理由'], [A.refundAudit, A.refundPath]),

  '补发换货/漏发赠品': P('yellow', ['明显不满+流失风险：赠品漏发'], [A.verifyPrior, A.reshipCreate, A.empathyFirst, A.etaCommit],
    ['核实出库记录后补发', '同步补发物流单号']),
  '补发换货/错发色号': P('yellow', ['履约失误：错发色号'], [A.photoEvidence, A.reshipCreate, A.exchangeOrReship, A.freightBear, A.etaCommit]),
  '补发换货/少发正装': P('yellow', ['履约失误：少发正装'], [A.verifyWeight, A.reshipCreate, A.etaCommit]),
  '补发换货/会员权益加赠补发': P('yellow', ['权益兑现问题：会员加赠未履约'], [A.verifyPrior, A.reshipCreate, A.etaCommit]),
  '补发换货/破损换货': P('yellow', ['履约质量问题：商品破损'], [A.photoEvidence, A.expressCheck, A.reshipCreate, A.reshipUrgent]),
  '补发换货/直播承诺赠品': P('yellow', ['直播间承诺兑现问题'], [A.verifyPrior, A.reshipCreate, A.etaCommit]),

  '订单服务/保价申请被拒': P('yellow', ['利益损失不满+流失风险：价保被拒后情绪升级'], [A.ruleExplain, A.empathyFirst, A.coupon50],
    ['规则解释需先共情后讲规则', '补偿以平台审批为准，不承诺超出权限的方案']),
  '订单服务/退款迟迟不到账': P('yellow', ['资金到账焦虑：退款未到账'], [A.refundPush, A.refundPath, A.offlinePay, A.etaCommit]),
  '订单服务/退款进度查询': P('green', ['常规服务：退款进度查询'], [A.refundPath, A.consultAnswer]),
  '订单服务/直播间承诺纠纷': P('yellow', ['承诺兑现争议：直播间权益'], [A.verifyPrior, A.empathyFirst, A.reshipCreate]),
  '订单服务/预售尾款咨询': P('green', ['常规咨询：预售/尾款'], [A.presaleAnswer]),
  '订单服务/发票申请': P('green', ['常规服务：发票申请'], [A.invoiceHandle]),

  '退款打款/大促价保补差': P('yellow', ['价保利益诉求：核对条件后补差'], [A.priceProtectCheck, A.offlinePay, A.etaCommit],
    ['确认在价保期内且为店铺降价', '线下打款需买家提供实名信息']),
  '退款打款/退款金额少退补打': P('yellow', ['资金争议：退款金额少退'], [A.refundAudit, A.refundPush, A.offlinePay, A.etaCommit]),
  '退款打款/售后期关闭过敏退款': P('yellow', ['健康关联退款：售后关闭后过敏退款'], [A.refundAudit, A.returnUnsuitable, A.callback24h, A.offlinePay],
    ['关联健康场景，注意停用与回访']),
  '退款打款/退货运费报销': P('green', ['常规服务：退货运费报销'], [A.refundAudit, A.refundPath, A.offlinePay]),

  '物流异常/物流停滞疑似丢件': P('yellow', ['履约焦虑+流失风险：物流停滞/疑似丢件'], [A.expressCheck, A.over48h, A.empathyFirst, A.etaCommit]),
  '物流异常/显示签收未收到': P('yellow', ['履约纠纷：签收未收到'], [A.expressCheck, A.empathyFirst, A.refundAudit]),
  '物流异常/包裹少件': P('yellow', ['履约问题：包裹少件'], [A.photoEvidence, A.expressCheck, A.reshipCreate, A.etaCommit]),
  '物流异常/包裹破损': P('yellow', ['履约问题：包裹破损'], [A.photoEvidence, A.expressCheck, A.reshipCreate]),
  '物流异常/拦截改址': P('green', ['常规服务：拦截/改址'], [A.warehouseIntercept, A.expressCheck, A.etaCommit]),

  '物流服务/催发货': P('green', ['常规服务：催发货'], [A.etaCommit, A.consultAnswer]),
  '物流服务/物流查询': P('green', ['常规服务：物流查询'], [A.consultAnswer]),

  '产品咨询/孕妇可用咨询': P('green', ['售前咨询：孕妇可用性'], [A.consultAnswer, A.medicalGuide],
    ['不提供医疗建议，按产品说明与官方信息回答']),
  '产品咨询/正品鉴别咨询': P('green', ['售前咨询：正品鉴别'], [A.consultAnswer]),
  '产品咨询/成分与肤质适配': P('green', ['售前咨询：成分与肤质'], [A.consultAnswer]),
  '产品咨询/色号选择': P('green', ['售前咨询：色号选择'], [A.recommend]),
  '产品咨询/套装搭配推荐': P('green', ['售前咨询：套装搭配'], [A.recommend]),
  '产品咨询/使用方法': P('green', ['售前/售后咨询：使用方法'], [A.consultAnswer]),
  '产品咨询/比价与决策': P('green', ['售前咨询：比价与决策'], [A.recommend]),
  '产品咨询/优惠与赠品咨询': P('green', ['售前咨询：优惠与赠品'], [A.consultAnswer]),

  '会员服务/积分兑换咨询': P('green', ['常规服务：会员积分'], [A.memberOps, A.consultAnswer]),
  '其他服务/好评回访': P('green', ['常规服务：好评回访'], [A.consultAnswer]),
  '综合咨询/一般咨询': P('green', ['常规咨询'], [A.consultAnswer]),
};

const MAJOR_FALLBACK = {
  '不良反应': P('red', ['健康安全风险'], [A.stopUse, A.registerAdverse, A.callback24h], ['不做医疗诊断与用药建议']),
  '售后退货': P('yellow', ['售后争议'], [A.refundAudit, A.empathyFirst]),
  '补发换货': P('yellow', ['履约失误'], [A.reshipCreate, A.etaCommit]),
  '订单服务': P('yellow', ['订单服务诉求'], [A.consultAnswer, A.etaCommit]),
  '退款打款': P('yellow', ['资金诉求'], [A.refundAudit, A.refundPath]),
  '物流异常': P('yellow', ['物流履约问题'], [A.expressCheck, A.empathyFirst]),
  '物流服务': P('green', ['常规物流服务'], [A.consultAnswer]),
  '产品咨询': P('green', ['售前咨询'], [A.consultAnswer]),
  '会员服务': P('green', ['会员服务'], [A.memberOps]),
  '其他服务': P('green', ['常规服务'], [A.consultAnswer]),
};

export function playbookFor(sceneKey, major) {
  if (sceneKey && PLAYBOOKS[sceneKey]) return PLAYBOOKS[sceneKey];
  if (major && MAJOR_FALLBACK[major]) return MAJOR_FALLBACK[major];
  return PLAYBOOKS['综合咨询/一般咨询'];
}

// 综合判定：场景基线 + 情绪曲线升级 + 会话事实
export function evaluateRisk({ sceneKey, major, intent, emotion, session, fusion }) {
  const book = playbookFor(sceneKey, major);
  let level = book.level;
  const reasons = [...book.reasons];
  const actions = [...book.actions];
  const compliance = [...book.compliance];

  const peak = emotion?.peak?.value ?? 0;
  const threats = (emotion?.points || []).flatMap((p) => p.hits).filter((h) =>
    ['投诉', '差评', '曝光', '举报', '平台申请', '平台介入', '315', '维权'].includes(h));

  if (level === 'green' && peak >= 66) {
    level = 'yellow';
    reasons.push(`会话情绪峰值 ${peak}，买家明显不满，存在流失风险`);
  }
  if (level !== 'red' && threats.length && peak >= 60) {
    level = 'red';
    reasons.push(`出现「${threats[0]}」等升级信号（情绪峰值 ${peak}），高冲突风险`);
  }
  if (level === 'green' && peak >= 76) {
    level = 'red';
    reasons.push(`情绪峰值 ${peak}，接近激烈冲突`);
  }

  const adverseTicket = session?.tickets?.find((t) => t.kind === 'adverse');
  if (adverseTicket && level !== 'red') {
    level = 'red';
    reasons.push(`存在不良反应工单 ${adverseTicket['工单号']}（健康风险）`);
  }
  // 轻度痘况（无不良反应工单）且买家诉求是退货退款时，按“使用不适”流程流转（与数据口径一致）
  if (!adverseTicket && sceneKey === '不良反应/闷痘爆痘' && (session?.messages || []).some((m) => m.isBuyer && /(退|退款|想退|能退)/.test(m.text))) {
    level = 'yellow';
    reasons.push('轻度痘况反馈并伴随退货诉求，按使用不适退货流程流转');
  }
  if (session?.tickets?.some((t) => t.kind === 'return' && String(t['退货原因']).includes('空包裹'))) {
    reasons.push('该会话存在空包裹风控核实记录');
  }
  if (level === 'green' && session?.tickets?.length) {
    level = 'yellow';
    reasons.push(`存在关联工单 ${session.tickets.length} 张，按数据口径处理强度至少为中风险`);
  }
  if (fusion?.buyer?.visits > 1 && level !== 'green') {
    reasons.push(`老客户（历史 ${fusion.buyer.visits - 1} 次接待），流失风险更高`);
  }
  if (level === 'green' && threats.length) {
    level = 'yellow';
    reasons.push(`出现「${threats[0]}」意向，需安抚闭环`);
    actions.unshift(A.empathyFirst);
  }

  return { level, sceneKey: sceneKey || '', reasons: [...new Set(reasons)], actions, compliance };
}
