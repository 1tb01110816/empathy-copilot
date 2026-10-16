// 规则分析编排：融合 → 意图 → 情绪 → 风险 → 验收对账 → 摘要/话术模板
import { buildFusion } from './fusion.js';
import { sessionIntents } from './intent.js';
import { buildEmotionCurve } from './emotion.js';
import { evaluateRisk } from './risk.js';
import { groundTruth, compareToTruth } from './eval.js';

const yuan = (n) => `¥${Number(n || 0).toFixed(0)}`;

// 规则话术模板：LLM 不可用时的兜底，同时作为 LLM 的“历史处理口径”参考
export const REPLY_TEMPLATES = {
  '不良反应/泛红刺痒': (c) =>
    `亲先别慌，非常抱歉让您担心了。请立即停用该产品，用清水洁面、做好基础保湿，暂时不要叠加其他护肤品。这边马上为您登记不良反应记录单，专员会在 24 小时内回访跟进；若出现加重或范围扩大，请及时就医。商品也可以走「使用不适」退货退款，运费由我们承担。`,
  '不良反应/过敏就医': (c) =>
    `非常抱歉给您带来这样的体验，您的健康最重要。请先停用并遵医嘱护理，方便的话请保留就医相关信息。这边即刻为您登记不良反应记录单并升级专员优先处理，24 小时内回访；相关订单支持「使用不适」退货退款，运费由我们承担。`,
  '不良反应/闷痘爆痘': (c) =>
    `很抱歉让您遇到这种情况。建议先停用该产品、简化护肤步骤观察几天。这边为您登记不良反应记录并安排专员 24 小时内回访；如持续加重请及时就医。商品支持「使用不适」退货退款，运费我们承担。`,
  '售后退货/仅退款疑似异常': (c) =>
    `亲亲您先别急，我们非常重视。空包裹需要按流程核实：请您先不要丢弃外箱和快递面单，拍摄外箱六面、面单和内件照片。我们已提交核实工单，将核对出库称重记录和物流揽收记录，有结果第一时间同步您；若核实确为漏发，第一时间为您补发或退款，绝不让您吃亏。`,
  '订单服务/保价申请被拒': (c) =>
    `非常理解您的心情，刚买不久就降价确实让人不舒服。按平台统一规则，超出价保期/秒杀类特殊活动的订单无法直接补差，我也没有权限突破规则。这边为您申请一张${c?.coupon || '50 元'}无门槛券作为补偿，您看可以吗？后续大促前欢迎先来问我，帮您把握最优价。`,
  '退款打款/大促价保补差': (c) =>
    `亲亲您先别急，已查到您的订单在 15 天价保期内且为店铺降价，符合价保条件。因订单已确认收货，系统无法原路退差，将走线下支付宝打款${c?.amount ? yuan(c.amount) : ''}，麻烦提供支付宝实名和账号，提交后 1-3 个工作日到账，请留意到账通知。`,
  '补发换货/漏发赠品': (c) =>
    `非常抱歉给您带来困扰，已帮您核对订单记录，确认赠品遗漏。这边马上为您创建补发工单${c?.urgent ? '并标记加急' : ''}，补发物流单号出来后第一时间同步您，请您留意快递信息。`,
  '补发换货/错发色号': (c) =>
    `实在抱歉发错色号了。麻烦您拍一张实物照片方便核对，这边马上为您安排换货/补发正确的色号，退回运费由我们承担，请您放心。`,
  '补发换货/破损换货': (c) =>
    `非常抱歉给您带来不好的体验。麻烦您拍下破损部位的照片，这边立刻为您创建补发换货工单${c?.urgent ? '并标记客诉加急' : ''}，尽快为您补发新的商品。`,
  '物流异常/物流停滞疑似丢件': (c) =>
    `亲亲别急，已记录您的情况。这边马上联系快递核实包裹位置，若确认超 48 小时停滞或丢件，将第一时间为您补发或退款，处理进度会主动同步您，无需反复查询。`,
  '物流异常/显示签收未收到': (c) =>
    `非常抱歉让您担心了。已为您联系快递核实签收记录（可能是驿站/代收点代签），核实结果出来第一时间联系您；若确认丢件，将立即为您补发或退款。`,
  '售后退货/质疑正品退货': (c) =>
    `非常理解您的担心，我们店铺所售商品均为官方正品。可以提供批次与官方渠道信息供您核验；如果您希望退货，我们按七天无理由为您办理，运费我们承担，请放心。`,
  '订单服务/直播间承诺纠纷': (c) =>
    `抱歉给您带来误解，已为您核对直播期间的承诺记录。确认属于承诺范围内的权益，这边马上安排补发/兑现，并在 24 小时内同步进度给您；如记录有出入，也请您提供截图，我们一定公正核实。`,
};

const GENERIC_REPLY = (c) =>
  `亲亲您好，已收到您的诉求${c?.sceneMinor ? `（${c.sceneMinor}）` : ''}，非常理解您现在的心情。这边马上为您核实处理，处理进度会主动同步给您，请放心。`;

// —— 话术「接情绪」前缀：根据买家当前情绪状态差异化开场，让话术贴合消费者心理（规则层，无 Key 也可用）——
// 仅在情绪较强时注入前缀，语义为「认可情绪 + 明确路径」，避免与场景模板开头重复道歉
const EMPATHY_PREFIX = {
  激烈冲突: '亲亲，收到您的情绪了，真的很抱歉让您这样不愉快。您说的每一点我都记下了，我们一定给您一个明确的交代：',
  强烈不满: '亲亲，理解您现在非常生气，让您有这种体验是我们的问题。您的诉求我已锁定，马上为您推进：',
  '明显不满/焦虑': '理解您现在的着急，请放心，您的情况我已经锁定，马上为您跟进处理：',
  轻度疑虑: '亲亲，您提到的这个点很关键，我来帮您确认清楚：',
};

export function templateReply(sceneKey, ctx = {}) {
  const fn = REPLY_TEMPLATES[sceneKey];
  const body = fn ? fn(ctx) : GENERIC_REPLY(ctx);
  const prefix = ctx.emotionState ? EMPATHY_PREFIX[ctx.emotionState] || '' : '';
  return prefix ? `${prefix}${body}` : body;
}

// —— 话术随对话轮次演进：开场共情 → 跟进推进 → 收尾安抚 ——
// 判定：未人工发送=开场；发送 1 轮后买家有新反馈=跟进；买家已收尾（演示闭环）或多轮后=收尾安抚
export const STAGE_LABELS = { opening: '开场共情', followup: '跟进推进', closing: '收尾安抚' };

export function dialogueStage(messages) {
  const liveTurns = messages.filter((m) => m.live && !m.isBuyer).length;
  if (liveTurns >= 2) return 'closing';
  if (liveTurns >= 1) return 'followup';
  const last = messages[messages.length - 1];
  // 演示自动出演已走到买家收尾（其后无人工发送）→ 会话视为闭环
  if (last?.isBuyer && last.simulated) return 'closing';
  return 'opening';
}

// 场景族：不良反应（健康优先）/ 空包裹核实（不做前置赔付承诺）/ 价保补偿（券与打款）/ 其余（工单与物流）
function stageFamily(sceneKey) {
  if (sceneKey.startsWith('不良反应/')) return 'adverse';
  if (sceneKey === '售后退货/仅退款疑似异常') return 'parcel';
  if (sceneKey === '订单服务/保价申请被拒' || sceneKey === '退款打款/大促价保补差') return 'price';
  return 'default';
}

// 跟进推进：承接买家最新反馈 + 推进安排 + 确定性承诺（不复述开场长道歉）
const FOLLOWUP_REPLIES = {
  adverse: () =>
    `亲亲，收到您的最新反馈了。专员已对您的情况加急跟进，会持续关注您的恢复情况，处理节点主动同步给您；也请您以身体感受为先，若不适加重请及时就医，照顾好自己最重要。`,
  parcel: () =>
    `亲亲，收到您的最新反馈了。核实正在加急推进：出库称重与揽收记录都会逐条核对，结果一出第一时间同步您，不需要反复来问；也麻烦您继续保留好外箱和面单，方便加快核实。`,
  price: () =>
    `亲亲，收到您的最新反馈了。您的申请已在优先推进，进度一旦更新我第一时间提醒您，您安心等待就好；有任何疑问随时留言，我帮您盯着，请放心。`,
  default: () =>
    `亲亲，收到您的最新反馈了。您的情况已进入优先跟进：处理进度与关键节点都会主动同步给您，不需要反复来问；有新变化随时留言告诉我，我一定帮您跟进好。`,
};

// 收尾安抚：感谢理解 + 闭环承诺 + 告别祝福（不引入新方案）
const CLOSING_REPLIES = {
  adverse: () =>
    `亲亲，非常感谢您的理解与配合。后续专员会持续跟进到闭环，进度不用您惦记，我们会主动同步；也祝您早日恢复，身体有任何情况随时来找我们，一定要照顾好自己。`,
  parcel: () =>
    `亲亲，非常感谢您的理解与耐心。核实会一直推进到有结果，无论结论如何都会第一时间同步您，您安心等待就好；也谢谢您配合留存包裹证据，辛苦啦。`,
  price: () =>
    `亲亲，感谢您的理解与支持。您的申请我们会持续跟进到落地，有更新第一时间提醒您；以后购物前也欢迎先来找我问价，帮您把价格权益把好关，祝您购物愉快。`,
  default: () =>
    `亲亲，非常感谢您的理解与耐心。您的事我们一定会跟进到闭环，进度主动同步、不让您多操心；以后有任何问题随时来找我，祝您生活愉快，天天开心呀。`,
};

export function stageReply(sceneKey, stage, ctx = {}) {
  if (stage === 'followup') return FOLLOWUP_REPLIES[stageFamily(sceneKey)](ctx);
  if (stage === 'closing') return CLOSING_REPLIES[stageFamily(sceneKey)](ctx);
  return templateReply(sceneKey, ctx);
}

export function ruleSummary(session, fusion, intent, emotion, risk) {
  const top = intent.dominant[0];
  const order = fusion.order;
  const parts = [];
  parts.push(`${fusion.buyer.visits > 1 ? '老客户' : '新客户'}「${session.buyer}」`);
  if (order) parts.push(`订单 ${order.name}（${yuan(order.amount)}，${order.status}）`);
  if (top) parts.push(`本会话诉求：${top.minor}`);
  const kindLabels = [...new Set(session.tickets.map((t) => t.kindLabel))];
  parts.push(kindLabels.length ? `已有工单：${kindLabels.join('、')}` : '无关联工单');
  if (emotion?.peak?.value >= 46) parts.push(`情绪峰值 ${emotion.peak.value}（${emotion.peak.snippet?.slice(0, 16)}…）`);
  return parts.join(' · ');
}

// 价保家族场景细判：结合客服话术判断“被拒”还是“可补差”
const PRICE_PROTECT_FAMILY = ['订单服务/保价申请被拒', '退款打款/大促价保补差'];
export function resolveSceneKey(intent, session, messages) {
  const top = intent.dominant[0];
  let sceneKey = top ? `${top.major}/${top.minor}` : (session.scenes[0] ? `${session.scenes[0].major}/${session.scenes[0].minor}` : '');
  if (PRICE_PROTECT_FAMILY.includes(sceneKey)) {
    const agentText = messages.filter((m) => m.role === '客服').map((m) => m.text).join('\n');
    const denied = /(超过|超出).{0,6}价保|不在.{0,6}(价保|范围)|无法.{0,4}补差|不支持.{0,6}价保/.test(agentText);
    sceneKey = denied ? '订单服务/保价申请被拒' : '退款打款/大促价保补差';
  }
  return sceneKey;
}

export function ruleAnalyze(session, uptoSeq = Infinity) {
  const messages = session.messages.filter((m) => m.seq <= uptoSeq);
  const fusion = buildFusion(session);
  const intent = sessionIntents(messages);
  const emotion = buildEmotionCurve(session.messages, uptoSeq);
  const top = intent.dominant[0];
  const sceneKey = resolveSceneKey(intent, session, messages);
  const stage = dialogueStage(messages);
  const risk = evaluateRisk({ sceneKey, major: sceneKey.split('/')[0], emotion, session, fusion });
  const gt = groundTruth(session);
  const evaluation = compareToTruth({ intent, risk, sceneKey }, gt);
  const lastBuyer = [...messages].reverse().find((m) => m.isBuyer && !m.simulated);

  const reply = stageReply(sceneKey, stage, {
    amount: fusion.order?.amount,
    sceneMinor: top?.minor,
    urgent: ['售后退货/仅退款疑似异常', '补发换货/破损换货'].includes(sceneKey),
    emotionState: emotion.state,
  });

  return {
    sessionId: session.id,
    uptoSeq: uptoSeq === Infinity ? session.stats.msgs : uptoSeq,
    fusion,
    sceneKey,
    stage,
    intent,
    lastBuyer: lastBuyer ? { seq: lastBuyer.seq, text: lastBuyer.text, contentType: lastBuyer.contentType, imageUrl: lastBuyer.imageUrl } : null,
    emotion,
    risk,
    evaluation,
    groundTruth: gt,
    summary: ruleSummary(session, fusion, intent, emotion, risk),
    reply,
    engine: 'rules',
    llm: false,
    generatedAt: new Date().toISOString(),
  };
}
