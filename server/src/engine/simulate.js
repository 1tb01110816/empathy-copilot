// 演示模式：自动出演多轮对话，直到问题解决闭环（模板兜底 + 有 Key 时 LLM 生成）
// 轮次：① 客服共情回复（场景话术）→ ② 买家缓和回应 → ③ 客服跟进确认 → ④ 买家安心收尾
// 约束：买家消息不得命中 intent.js 的场景关键词（classifyText 必须为 null），避免引入错误意图切换
// 只演不做：本模块只产对话文本，不触发任何动作执行
import { chatJson, llmAvailable } from '../llm/qwen.js';
import { classifyText } from './intent.js';

// —— 第 ② 幕：买家刚收到共情回复（缓和、愿配合、等结果）——
const PROGRESS = {
  '不良反应/泛红刺痒': '好吧，听你这么说我心里踏实点了。我先按这个方法来，也等专员的回访，谢谢你们。',
  '不良反应/过敏就医': '好的，谢谢提醒，我会先照顾好自己。后续就麻烦你们帮忙安排，我等你们消息。',
  '不良反应/闷痘爆痘': '好吧，那我先停一段时间观察看看，也等你们安排的回访，谢谢。',
  '售后退货/仅退款疑似异常': '行，那箱子我先留着不动，按你们说的拍照。核实结果出来记得同步我，谢谢。',
  '订单服务/保价申请被拒': '好吧，我理解你们也有流程要守。这张券我先收下，以后有需要再来找你们，谢谢。',
  '退款打款/大促价保补差': '好嘞，那我这就去把收款信息发过去。麻烦你们安排，有动静了跟我说一声，谢谢。',
  '补发换货/漏发赠品': '太好了，那麻烦你们安排寄过来，东西到了我再用起来，谢谢。',
  '补发换货/错发色号': '好的，我这就拍一张发给你们。麻烦帮我换一下，谢谢啦。',
  '补发换货/破损换货': '嗯嗯，照片这就拍。辛苦你们帮忙处理，我等你们的好消息。',
  '物流异常/物流停滞疑似丢件': '好的，那就辛苦你们帮忙盯一下，有结果第一时间跟我说，谢谢。',
  '物流异常/显示签收未收到': '嗯，那辛苦你们帮忙核实一下，有消息记得告诉我，谢谢。',
  '售后退货/质疑正品退货': '好的，那我先看看你们发的信息。谢谢你们耐心解释，有需要我再联系。',
  '订单服务/直播间承诺纠纷': '行，那我等你们的安排，希望后面顺利一点，谢谢。',
};
const PROGRESS_GENERICS = [
  '好吧，听你们这么说我心里舒服多了。那就麻烦你们了，我等你们的好消息，谢谢。',
  '好的，谢谢你们耐心解释，我先等等看，有进展麻烦跟我说一声。',
  '嗯，那就按你们说的来，麻烦你们多费心，谢谢。',
];

// —— 第 ④ 幕：买家收到跟进确认后安心收尾（问题视为圆满解决）——
const CLOSINGS = {
  '不良反应/泛红刺痒': '那我就放心了，先按你说的来。辛苦你们了，谢谢。',
  '不良反应/过敏就医': '好，那我就安心等你们的消息，谢谢你们这么上心。',
  '不良反应/闷痘爆痘': '嗯，那我就放心慢慢养着了，麻烦你们了，谢谢。',
  '售后退货/仅退款疑似异常': '行，那等你们核实结果，我先照常收着，谢谢。',
  '订单服务/保价申请被拒': '好的，那就这样说定了，谢谢你们替我争取。',
  '退款打款/大促价保补差': '好嘞，那我等你消息，辛苦你们跑流程，谢谢。',
  '补发换货/漏发赠品': '太好了，那我就等着啦，谢谢你们，辛苦。',
  '补发换货/错发色号': '好，那我等换了，麻烦了，谢谢你们。',
  '补发换货/破损换货': '嗯，那我有数了，就等你们安排，谢谢。',
  '物流异常/物流停滞疑似丢件': '好的，那我就等结果了，麻烦你们多留意，谢谢。',
  '物流异常/显示签收未收到': '好的，那我等你们消息，麻烦帮忙跟紧一点，谢谢。',
  '售后退货/质疑正品退货': '好，那我心里有底了，谢谢你们耐心说明。',
  '订单服务/直播间承诺纠纷': '行，那就麻烦你们了，我等结果，谢谢。',
};
const CLOSING_GENERICS = [
  '好，那我就放心了，辛苦你们，谢谢。',
  '嗯，那我等你们的好消息，麻烦你们多上心，谢谢。',
  '行，那咱们就这么说定了，谢谢你们耐心处理。',
];

// —— 第 ③ 幕：客服跟进确认（进度同步话术，不触发任何真实动作）——
const FOLLOWUPS = {
  '不良反应/泛红刺痒': '已按流程为您安排专员跟进，处理节点会陆续同步给您；期间皮肤有任何变化，随时来找我们，请放心。',
  '不良反应/过敏就医': '已为您升级专员优先跟进，会与您保持联系确认恢复情况，也请以医嘱为主，安心护理。',
  '不良反应/闷痘爆痘': '已安排专员跟进回访，会持续关注您的情况，有变化随时联系我们。',
  '售后退货/仅退款疑似异常': '核实工单已在推进，出库与揽收记录都会逐条核对，结果一出第一时间同步您，请放心。',
  '订单服务/保价申请被拒': '补偿券已按流程为您申请，到账后消息里即可查看；后续买东西先来问我，帮您把价格把好关。',
  '退款打款/大促价保补差': '打款申请已在走流程，到账后我会主动跟您确认，请留意消息，谢谢您的配合。',
  '补发换货/漏发赠品': '补发流程已在安排，寄出后会第一时间把物流进度同步给您，不用反复来问，请放心。',
  '补发换货/错发色号': '换货流程已在安排，寄出与到货节点都会主动同步给您，麻烦您留意消息。',
  '补发换货/破损换货': '已为您安排处理优先级，进度会主动同步；给您添麻烦了，感谢理解。',
  '物流异常/物流停滞疑似丢件': '已联系快递推进核实，有进展第一时间同步您，无需反复查询，请放心。',
  '物流异常/显示签收未收到': '核实结果一出会第一时间联系您，在此之前无须重复询问，保持电话畅通即可。',
  '售后退货/质疑正品退货': '批次与渠道信息已按流程为您整理，查看中有疑问随时找我们，一定给您说明白。',
  '订单服务/直播间承诺纠纷': '承诺核对结果出来后第一时间同步您，属实的权益会按流程兑现，请放心。',
};
const FOLLOWUP_GENERICS = [
  '您的情况已在跟进处理中，后续进展会第一时间同步给您，有需要随时找我们，请放心。',
  '这边会持续跟进您的问题，处理进度主动同步，您安心等待就好，谢谢理解。',
];

let genSeq = 0;

// used：对话中已出现过的买家文本集合；传入时优先挑未出现过的模板，避免出演与演示/历史复读
export function templateReaction(sceneKey, stage = 'progress', used = null) {
  const primary = stage === 'closing' ? CLOSINGS[sceneKey] : PROGRESS[sceneKey];
  const generics = stage === 'closing' ? CLOSING_GENERICS : PROGRESS_GENERICS;
  if (used?.size) {
    const fresh = [primary, ...generics].filter(Boolean).find((t) => !used.has(t));
    if (fresh) return fresh;
  }
  return primary || generics[genSeq++ % generics.length];
}

export function templateFollowup(sceneKey) {
  return FOLLOWUPS[sceneKey] || FOLLOWUP_GENERICS[genSeq++ % FOLLOWUP_GENERICS.length];
}

const SYS = [
  '你是电商买家演员。请替买家连续写两条再回复：第一条是刚收到客服共情回复后的即时回应',
  '（情绪缓和、表示理解或愿意配合，等待处理结果）；第二条是随后收到客服「处理进度已在跟进」',
  '的确认话术后，表达安心、认可与感谢的收尾回应（视为问题已圆满解决）。',
  '只输出 JSON：{"reactions":["第一条","第二条"]}。要求：每条 40 字以内、口语化；',
  '不复述任何诉求细节、产品词、金额、单号；不提退货/退款/赔偿等任何处理方式；不要反问句。',
].join('');

const validReaction = (t) => !!t && t.length <= 60 && !t.includes('\n') && !classifyText(t);

export async function buyerReactions({ sceneKey, buyerText, replyText }) {
  if (llmAvailable()) {
    try {
      const { json } = await chatJson({
        system: SYS,
        user: `买家场景：${sceneKey}\n买家此前原话：${buyerText}\n客服刚回复：${replyText}`,
        temperature: 0.8,
        maxTokens: 320,
        timeoutMs: 20000,
      });
      const arr = Array.isArray(json.reactions) ? json.reactions : [];
      const texts = arr.slice(0, 2).map((t) => String(t || '').replace(/\s+/g, ' ').trim());
      if (texts.length === 2 && texts.every(validReaction)) return { texts, source: 'llm' };
    } catch {
      /* 无 Key / 超时 / 解析失败 → 模板兜底 */
    }
  }
  return { texts: [templateReaction(sceneKey, 'progress'), templateReaction(sceneKey, 'closing')], source: 'template' };
}

// 组装演示对话（4 条：客服回复 → 买家回应 → 客服跟进 → 买家收尾）
export async function demoDialogue(session, analysis) {
  const lastBuyer = [...session.messages].reverse().find((m) => m.isBuyer);
  const reactions = await buyerReactions({
    sceneKey: analysis.sceneKey,
    buyerText: lastBuyer?.text || '',
    replyText: analysis.reply,
  });
  const sender = `${session.shop}:演示客服`;
  return [
    { role: '客服', sender, isBuyer: false, text: analysis.reply },
    { role: '买家', sender: '买家', isBuyer: true, text: reactions.texts[0] },
    { role: '客服', sender, isBuyer: false, text: templateFollowup(analysis.sceneKey) },
    { role: '买家', sender: '买家', isBuyer: true, text: reactions.texts[1] },
  ];
}

// —— 人工发送（采纳并发送 / 手动回复）后的买家出演：每条人工回复 → 一条买家回应，直到买家确认解决 ——
const LIVE_SYS = [
  '你是电商买家演员，正在与客服进行多轮对话。请根据最近的对话记录和客服最新回复，替买家写一条简短的再回复。',
  '若客服回复已给出有效方案、安抚或明确的跟进安排，买家表达安心、认可与感谢（问题视为解决，resolved=true）；',
  '若还需等待或进一步确认，买家表达缓和与配合、等待后续消息（resolved=false）。',
  '只输出 JSON：{"reaction":"...","resolved":true 或 false}。要求：40 字以内、口语化；',
  '不复述任何诉求细节、产品词、金额、单号；不提退货/退款/赔偿等任何处理方式；不提新问题；不要反问句；不要与对话记录里买家已说过的话重复。',
].join('');

// priorLive：此前人工已发送的客服回复条数（0 起）；1 条后买家确认解决；>=2 条时 /send 不再调用本函数（闭环收尾，买家不再出演回复）
// usedTexts：对话中已出现过的买家文本（含演示模拟）——出演文本避开它们，避免复读
export async function buyerNextReaction({ sceneKey, history, agentText, priorLive = 0, usedTexts = [] }) {
  const used = new Set(usedTexts.map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  if (llmAvailable()) {
    try {
      const { json } = await chatJson({
        system: LIVE_SYS,
        user: `对话记录：\n${history}\n客服最新回复：${agentText}`,
        temperature: 0.8,
        maxTokens: 220,
        timeoutMs: 20000,
      });
      const text = String(json.reaction || '').replace(/\s+/g, ' ').trim();
      if (validReaction(text) && !used.has(text)) return { text, resolved: !!json.resolved, source: 'llm' };
    } catch {
      /* 无 Key / 超时 / 解析失败 → 模板兜底 */
    }
  }
  const resolved = priorLive >= 1;
  return { text: templateReaction(sceneKey, resolved ? 'closing' : 'progress', used), resolved, source: 'template' };
}
