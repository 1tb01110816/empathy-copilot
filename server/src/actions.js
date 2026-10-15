// 动作执行层：客服确认后执行 → 动作结果回流为消费者端进度通知（双端闭环）
import { getSession } from './store.js';
import { dbMode, dbQuery } from './db.js';

let idSeq = 0;
let msgSeq = 1000;
const runtime = new Map(); // sessionId -> { actions: [], messages: [] }

const nowStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const genId = (prefix) => `${prefix}${String(Date.now()).slice(-7)}${String(++idSeq % 1000).padStart(3, '0')}`;

const DEFAULT_PAYLOAD = (session) => ({
  sessionId: session.id,
  orderId: session.order?.['订单号'] || '',
  buyer: session.buyer,
});

export const ACTION_DEFS = {
  register_adverse: {
    label: '登记不良反应单', idPrefix: 'BLFY',
    notify: (pay) => `已为您登记不良反应记录单（编号 ${pay._id}），专员将在 24 小时内回访跟进，请留意来电；期间请先停用产品、清水洁面，如症状加重请及时就医。`,
  },
  create_reship: {
    label: '创建补发换货工单', idPrefix: 'BH',
    notify: (pay) => `已为您创建补发工单（${pay._id}）${pay.urgent ? '并标记加急' : ''}，预计 48 小时内发出，物流单号出来后第一时间同步您。`,
  },
  risk_check: {
    label: '转风控核实', idPrefix: 'KOC',
    notify: (pay) => `空包裹核实已提交（${pay._id}），我们将核验出库称重与物流揽收记录，结果出来后第一时间联系您；请您先保留外箱和面单，感谢配合。`,
  },
  issue_coupon: {
    label: '发放无门槛券', idPrefix: 'HV',
    notify: (pay) => `已完成补偿：${pay.amount || 50} 元无门槛券已发放至您的账户（${pay._id}），有效期 30 天，下单时可直接抵扣。`,
  },
  offline_pay: {
    label: '发起线下打款', idPrefix: 'HV',
    notify: (pay) => `补差打款申请已提交（${pay._id}），${pay.amount ? `金额 ¥${pay.amount}，` : ''}1-3 个工作日到账支付宝，请留意到账通知。`,
  },
  refund: {
    label: '受理退货退款', idPrefix: 'TK',
    notify: (pay) => `退款申请已受理（${pay._id}）${pay.amount ? `，金额 ¥${pay.amount}` : ''}，预计 1-3 个工作日原路退回，请留意到账。`,
  },
  escalate: {
    label: '升级专员处理', idPrefix: 'ZS',
    notify: (pay) => `已为您升级专员优先处理（${pay._id}），专员将在 2 小时内主动联系您，无需重复描述问题。`,
  },
};

function ensureBucket(sessionId) {
  if (!runtime.has(sessionId)) runtime.set(sessionId, { actions: [], messages: [] });
  return runtime.get(sessionId);
}

export async function executeAction(sessionId, type, payload = {}) {
  const session = getSession(sessionId);
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 });
  const def = ACTION_DEFS[type];
  if (!def) throw Object.assign(new Error(`unknown action type: ${type}`), { status: 400 });

  const id = genId(def.idPrefix);
  const at = nowStr();
  const merged = { ...DEFAULT_PAYLOAD(session), ...payload, _id: id };
  const record = {
    id, type, label: def.label, at,
    status: /coupon|pay|refund|escalate/i.test(type) ? '已提交' : '处理中',
    fields: Object.fromEntries(Object.entries(merged).filter(([k]) => !k.startsWith('_'))),
  };
  const bucket = ensureBucket(sessionId);
  bucket.actions.push(record);

  const message = {
    seq: ++msgSeq,
    time: at,
    role: '系统推送',
    sender: '共情副驾',
    isBuyer: false,
    isSystem: true,
    runtime: true,
    contentType: '文本',
    text: `【进度同步 · ${def.label}】${def.notify(merged)}`,
  };
  bucket.messages.push(message);

  if (dbMode() === 'mysql' && session.tryMode) {
    await dbQuery(
      'INSERT INTO runtime_actions (id, session_id, type, label, at, status, fields_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [record.id, sessionId, record.type, record.label, record.at, record.status, JSON.stringify(record.fields)],
    );
    await dbQuery(
      'INSERT INTO runtime_messages (seq, session_id, time, text) VALUES (?, ?, ?, ?)',
      [message.seq, sessionId, message.time, message.text],
    );
  }

  return { record, message };
}

export function clearRuntime(sessionId) {
  runtime.delete(sessionId);
}

// 启动时从 MySQL 水合试跑会话的运行时记录（仅 TRY 前缀会话；真实会话保持内存态）
export async function initRuntimeFromDb() {
  if (dbMode() !== 'mysql') return;
  const [actions] = await dbQuery('SELECT id, session_id, type, label, at, status, fields_json FROM runtime_actions ORDER BY at ASC, id ASC');
  const [messages] = await dbQuery('SELECT seq, session_id, time, text FROM runtime_messages ORDER BY seq ASC');
  const parseFields = (raw) => {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  };
  for (const a of actions) {
    const bucket = ensureBucket(a.session_id);
    bucket.actions.push({ id: a.id, type: a.type, label: a.label, at: a.at, status: a.status, fields: parseFields(a.fields_json) });
  }
  for (const m of messages) {
    const bucket = ensureBucket(m.session_id);
    bucket.messages.push({
      seq: m.seq,
      time: m.time,
      role: '系统推送',
      sender: '共情副驾',
      isBuyer: false,
      isSystem: true,
      runtime: true,
      contentType: '文本',
      text: m.text,
    });
    if (m.seq >= msgSeq) msgSeq = m.seq + 1;
  }
}

export function runtimeActions(sessionId) {
  return runtime.get(sessionId)?.actions || [];
}

export function runtimeMessages(sessionId) {
  return runtime.get(sessionId)?.messages || [];
}
