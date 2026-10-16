import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDb, mockTablesReady, importMockData, loadMockRows, ensureTryTables, dbQuery, dbMode, dbStatus, dbDemote } from './db.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const readRows = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));

const toObjects = (rows) => {
  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};

export const TICKET_KINDS = {
  reship: { label: '补发换货工单', reasonField: '售后原因', statusField: '工单状态', createdField: '创建时间' },
  payoff: { label: '线下打款工单', reasonField: '退款问题类型', statusField: '工单状态', createdField: '创建时间' },
  logistics: { label: '物流工单', reasonField: '问题类型', statusField: '工单状态', createdField: '创建时间' },
  adverse: { label: '不良反应工单', reasonField: '症状描述', statusField: '任务状态', createdField: '创建时间' },
  return: { label: '售后退货工单', reasonField: '退货原因', statusField: '任务状态', createdField: '创建时间' },
};

export const DEMO_SESSIONS = [
  { id: 'S00010', title: '不良反应 · 泛红刺痒', tone: 'red', tag: '健康风险', desc: '面膜用后全脸泛红起疹，需停用+登记+24h回访' },
  { id: 'S00003', title: '保价被拒 · 情绪升级', tone: 'yellow', tag: '流失风险', desc: '刚买就降价 40 元，超 15 天价保被拒→发券挽回' },
  { id: 'S00024', title: '空包裹 · 风控纠纷', tone: 'red', tag: '资损风险', desc: '买家称收到空箱要求仅退款，需转风控核实' },
  { id: 'S00018', title: '错发色号 · 实拍取色', tone: 'yellow', tag: '多模态', desc: '买家实拍收到的色号与订单不符，识图对比→补发换货' },
];

function loadFromJson() {
  const chat = toObjects(readRows('chat.json'));
  const orders = toObjects(readRows('orders.json'));
  const tickets = [];
  for (const [kind, meta] of Object.entries(TICKET_KINDS)) {
    for (const t of toObjects(readRows(`tickets_${kind}.json`))) {
      tickets.push({ kind, kindLabel: meta.label, ...t });
    }
  }
  return { chat, orders, tickets };
}

async function loadFromDb() {
  const chat = toObjects(await loadMockRows('chat'));
  const orders = toObjects(await loadMockRows('orders'));
  const tickets = [];
  for (const [kind, meta] of Object.entries(TICKET_KINDS)) {
    for (const t of toObjects(await loadMockRows(`tickets_${kind}`))) {
      tickets.push({ kind, kindLabel: meta.label, ...t });
    }
  }
  return { chat, orders, tickets };
}

const sessions = new Map();
const ordersById = new Map();
const ticketsById = new Map();
const buyerIndex = new Map(); // 昵称 -> { sessions:[], orders:[], tickets:[] }

function ensureBuyer(nick) {
  if (!buyerIndex.has(nick)) buyerIndex.set(nick, { nickname: nick, sessions: [], orders: [], tickets: [] });
  return buyerIndex.get(nick);
}

function buildFrom({ chat, orders, tickets }) {
  sessions.clear();
  ordersById.clear();
  ticketsById.clear();
  buyerIndex.clear();

  for (const o of orders) {
    ordersById.set(o['订单号'], o);
  }
  for (const t of tickets) {
    ticketsById.set(t['工单号'], t);
  }

  // 会话聚合
  const bySession = new Map();
  for (const m of chat) {
    const sid = m['会话ID'];
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(m);
  }

  for (const [sid, rows] of bySession) {
    rows.sort((a, b) => Number(a['消息序号']) - Number(b['消息序号']));
    const first = rows[0];
    const imageCat = (p) => {
      const m = /^mock_images\/([^/]+)\//.exec(p || '');
      return m ? m[1] : null;
    };
    const messages = rows.map((r) => {
      const role = r['角色'];
      const img = String(r['image_path'] || '').trim();
      return {
        seq: Number(r['消息序号']),
        id: r['message_id'],
        time: r['发送时间'],
        role,
        sender: r['发送方'],
        isBuyer: role === '买家',
        isSystem: role === '系统推送',
        text: r['message_text'],
        contentType: r['内容类型'] || '文本',
        imagePath: img || null,
        imageUrl: img ? `/mock_images/${imageCat(img)}.jpg` : null,
        sceneMajor: r['scene_major'] || '',
        sceneMinor: r['scene_minor'] || '',
        orderId: String(r['关联订单号'] || '').trim(),
        ticketId: String(r['关联工单号'] || '').trim(),
        category: r['category'] || '',
      };
    });

    const sceneCount = new Map();
    for (const m of messages) {
      if (!m.sceneMajor) continue;
      const key = `${m.sceneMajor}/${m.sceneMinor}`;
      sceneCount.set(key, (sceneCount.get(key) || 0) + 1);
    }
    const scenes = [...sceneCount.entries()]
      .map(([key, count]) => {
        const [major, minor] = key.split('/');
        return { major, minor, count };
      })
      .sort((a, b) => b.count - a.count);

    const order =
      ordersById.get(String(first['关联订单号'] || '').trim()) ||
      orders.find((o) => o['会话ID'] === sid) ||
      null;
    const sessionTickets = tickets.filter((t) => t['会话ID'] === sid);

    const buyer = first['买家昵称'];
    const session = {
      id: sid,
      buyer,
      shop: first['店铺'],
      messages,
      order,
      tickets: sessionTickets,
      scenes,
      startTime: first['发送时间'],
      endTime: rows[rows.length - 1]['发送时间'],
      stats: {
        msgs: messages.length,
        buyerMsgs: messages.filter((m) => m.isBuyer).length,
        images: messages.filter((m) => m.contentType === '图片').length,
      },
      demo: DEMO_SESSIONS.find((d) => d.id === sid) || null,
    };
    sessions.set(sid, session);

    ensureBuyer(buyer).sessions.push(sid);
  }

  for (const o of orders) {
    const b = buyerIndex.get(o['买家昵称']);
    if (b) b.orders.push(o['订单号']);
  }
  for (const t of tickets) {
    const b = buyerIndex.get(t['买家昵称']);
    if (b) b.tickets.push(t['工单号']);
  }

  // 会话按开始时间排序（后开的在前），演示会话置顶由接口层处理
  for (const s of sessions.values()) s.sceneKey = s.scenes[0] ? `${s.scenes[0].major}/${s.scenes[0].minor}` : '未知';
}

let initialized = false;

// 启动初始化：MySQL 可用则接入（缺表自动导入 8 张 MOCK 表）；否则降级 JSON + 内存模式
export async function initStore() {
  if (initialized) return dbStatus();
  initialized = true;
  if (await connectDb()) {
    try {
      if (!(await mockTablesReady())) {
        console.log('[db] 首次初始化：导入赛题 8 张 MOCK 表到 MySQL…');
        await importMockData();
      }
      await ensureTryTables();
      buildFrom(await loadFromDb());
      await loadTrySessionsFromDb();
      return dbStatus();
    } catch (e) {
      console.error('[db] MySQL 读取失败，降级为 JSON + 内存模式：', String(e.message || e));
      await dbDemote(String(e.message || e));
    }
  }
  buildFrom(loadFromJson());
  return dbStatus();
}

export function getSession(id) {
  return sessions.get(id) || trySessions.get(id) || null;
}

export function getAllSessions() {
  return [...sessions.values()];
}

export function getOrder(id) {
  return ordersById.get(id) || null;
}

export function getTicket(id) {
  return ticketsById.get(id) || null;
}

// —— 试跑「可选关联」搜索：从赛题 MOCK 库检索订单 / 工单（按订单号/商品/买家/物流单号等关键词）——
function pickOrderRef(o) {
  return {
    id: o['订单号'],
    name: o['商品名称'],
    amount: Number(o['实付金额(元)'] || 0),
    status: o['订单状态'],
    buyer: o['买家昵称'],
    courier: o['快递公司'],
    tracking: o['物流单号'],
  };
}

export function searchOrders(q = '') {
  const t = String(q).trim().toLowerCase();
  const all = [...ordersById.values()];
  if (!t) return all.slice(0, 8).map(pickOrderRef);
  return all
    .filter((o) =>
      [o['订单号'], o['商品名称'], o['商品货号'], o['买家昵称'], o['物流单号'], o['订单状态']].some((v) =>
        String(v || '').toLowerCase().includes(t),
      ),
    )
    .slice(0, 8)
    .map(pickOrderRef);
}

function pickTicketRef(tk) {
  return {
    id: tk['工单号'],
    kind: tk.kind,
    kindLabel: tk.kindLabel,
    orderId: tk['关联订单号'] || '',
    buyer: tk['买家昵称'],
    status: tk['工单状态'] || tk['任务状态'],
    reason: String(tk['症状描述'] || tk['退货原因'] || tk['问题类型'] || tk['售后原因'] || tk['退款问题类型'] || '').slice(0, 24),
  };
}

export function searchTickets(q = '') {
  const t = String(q).trim().toLowerCase();
  const all = [...ticketsById.values()];
  if (!t) return all.slice(0, 8).map(pickTicketRef);
  return all
    .filter((tk) =>
      [tk['工单号'], tk['关联订单号'], tk['买家昵称'], tk['使用商品'], tk['症状描述'], tk['退货原因'], tk['问题类型'], tk['售后原因'], tk['退款问题类型']].some((v) =>
        String(v || '').toLowerCase().includes(t),
      ),
    )
    .slice(0, 8)
    .map(pickTicketRef);
}

export function getBuyer(nick) {
  return buyerIndex.get(nick) || null;
}

export function buyerHistory(nick, excludeSessionId) {
  const b = buyerIndex.get(nick);
  if (!b) return { priorSessions: [], priorOrders: [], priorTickets: [], totalSpend: 0 };
  const priorSessions = b.sessions.filter((s) => s !== excludeSessionId).map((id) => sessions.get(id));
  const priorOrders = b.orders.map((id) => ordersById.get(id)).filter(Boolean);
  const priorTickets = b.tickets.map((id) => ticketsById.get(id)).filter(Boolean);
  const totalSpend = priorOrders.reduce((sum, o) => sum + Number(o['实付金额(元)'] || 0), 0);
  return { priorSessions, priorOrders, priorTickets, totalSpend };
}

export function sessionList() {
  return [...sessions.values()].map((s) => {
    const lastBuyerMsg = [...s.messages].reverse().find((m) => m.isBuyer);
    return {
      id: s.id,
      buyer: s.buyer,
      startTime: s.startTime,
      endTime: s.endTime,
      sceneKey: s.sceneKey,
      sceneMajor: s.scenes[0]?.major || '',
      sceneMinor: s.scenes[0]?.minor || '',
      msgs: s.stats.msgs,
      images: s.stats.images,
      hasOrder: !!s.order,
      ticketKinds: s.tickets.map((t) => t.kind),
      preview: lastBuyerMsg ? lastBuyerMsg.text.slice(0, 40) : '',
      demo: s.demo,
    };
  });
}

export function datasetStats() {
  const all = [...sessions.values()];
  return {
    sessions: all.length,
    messages: all.reduce((n, s) => n + s.stats.msgs, 0),
    buyerMessages: all.reduce((n, s) => n + s.stats.buyerMsgs, 0),
    images: all.reduce((n, s) => n + s.stats.images, 0),
    orders: ordersById.size,
    tickets: ticketsById.size,
    buyers: buyerIndex.size,
    sessionsWithOrder: all.filter((s) => s.order).length,
    sessionsWithTicket: all.filter((s) => s.tickets.length > 0).length,
  };
}

// —— 试跑会话：现场输入的临时会话（仅内存，不参与赛题数据统计与洞察对账）——
const trySessions = new Map();
const TRY_MAX = 20;
let trySeq = 0;

async function persistTryMessages(session, msgs) {
  if (dbMode() !== 'mysql' || !msgs.length) return;
  const rows = msgs.map((m) => [
    m.id, session.id, m.seq, m.time, m.role, m.sender,
    m.isBuyer ? 1 : 0, m.simulated ? 1 : 0, m.live ? 1 : 0,
    m.text, m.contentType || '文本', m.imageUrl,
  ]);
  await dbQuery(
    'INSERT INTO try_messages (id, session_id, seq, time, role, sender, is_buyer, simulated, live, text, content_type, image_url) VALUES ?',
    [rows],
  );
}

async function deleteTrySessionRow(id) {
  if (dbMode() !== 'mysql') return;
  await dbQuery('DELETE FROM try_sessions WHERE id = ?', [id]);
  await dbQuery('DELETE FROM runtime_actions WHERE session_id = ?', [id]);
  await dbQuery('DELETE FROM runtime_messages WHERE session_id = ?', [id]);
}

export async function createTrySession({ text = '', imageDataUrl = null, orderId = null, ticketId = null, buyerType = 'default' } = {}) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const id = `TRY${String(Date.now()).slice(-6)}${String(++trySeq % 100).padStart(2, '0')}`;

  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20);
  const messages = lines.map((line, i) => ({
    seq: i + 1,
    id: `${id}-${i + 1}`,
    time: `${base}:${p((d.getSeconds() + i) % 60)}`,
    role: '买家',
    sender: '买家',
    isBuyer: true,
    text: line,
    contentType: '文本',
    imagePath: null,
    imageUrl: null,
    sceneMajor: '',
    sceneMinor: '',
    orderId: '',
    ticketId: '',
    category: '',
  }));
  if (imageDataUrl) {
    messages.push({
      seq: messages.length + 1,
      id: `${id}-img`,
      time: `${base}:${p((d.getSeconds() + lines.length) % 60)}`,
      role: '买家',
      sender: '买家',
      isBuyer: true,
      text: '（买家发来图片）',
      contentType: '图片',
      imagePath: null,
      imageUrl: imageDataUrl,
      sceneMajor: '',
      sceneMinor: '',
      orderId: '',
      ticketId: '',
      category: '',
    });
  }

  const session = {
    id,
    buyer: '试跑买家',
    shop: '测试美妆旗舰店',
    messages,
    order: orderId ? getOrder(orderId) : null,
    tickets: ticketId ? [getTicket(ticketId)].filter(Boolean) : [],
    buyerType: ['urgent', 'hesitant', 'rational', 'default'].includes(buyerType) ? buyerType : 'default',
    scenes: [],
    startTime: messages[0].time,
    endTime: messages[messages.length - 1].time,
    stats: {
      msgs: messages.length,
      buyerMsgs: messages.length,
      images: imageDataUrl ? 1 : 0,
    },
    demo: null,
    tryMode: true,
  };
  trySessions.set(id, session);
  // 上限淘汰：删除最旧的一条（内存 + MySQL 同步）
  while (trySessions.size > TRY_MAX) {
    const oldest = trySessions.keys().next().value;
    trySessions.delete(oldest);
    await deleteTrySessionRow(oldest);
  }
  if (dbMode() === 'mysql') {
    await dbQuery(
      'INSERT INTO try_sessions (id, buyer, shop, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, session.buyer, session.shop, session.startTime, session.endTime, nowStr()],
    );
    await persistTryMessages(session, session.messages);
  }
  return session;
}

// 演示模式：向试跑会话追加模拟消息（客服回复 / 买家反应），时间戳逐秒顺延（跨分钟安全）
// simulated: false 按正常对话显示（人工发送的客服消息与买家出演均传 false）；自动播放的演示消息默认 simulated: true
export async function appendTryMessages(session, msgs) {
  const last = session.messages[session.messages.length - 1];
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const m = last ? /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(last.time) : null;
  const cursor = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date();
  for (const msg of msgs) {
    cursor.setSeconds(cursor.getSeconds() + 1);
    session.messages.push({
      seq: session.messages.length + 1,
      id: `${session.id}-s${session.messages.length + 1}`,
      time: fmt(cursor),
      role: msg.role,
      sender: msg.sender,
      isBuyer: !!msg.isBuyer,
      isSystem: false,
      live: !!msg.live,
      text: msg.text,
      contentType: '文本',
      imagePath: null,
      imageUrl: null,
      sceneMajor: '',
      sceneMinor: '',
      orderId: '',
      ticketId: '',
      category: '',
      simulated: msg.simulated !== false,
    });
  }
  const lastMsg = session.messages[session.messages.length - 1];
  session.endTime = lastMsg.time;
  session.stats.msgs = session.messages.length;
  session.stats.buyerMsgs = session.messages.filter((m) => m.isBuyer).length;
  const added = session.messages.slice(-msgs.length);
  if (dbMode() === 'mysql' && added.length) {
    await persistTryMessages(session, added);
    await dbQuery('UPDATE try_sessions SET end_time = ? WHERE id = ?', [session.endTime, session.id]);
  }
  return added;
}

// 启动时从 MySQL 水合试跑会话与消息（仅 MySQL 模式）
async function loadTrySessionsFromDb() {
  if (dbMode() !== 'mysql') return;
  const [rows] = await dbQuery('SELECT id, buyer, shop, start_time, end_time FROM try_sessions ORDER BY created_at ASC, id ASC');
  for (const r of rows) {
    const [msgs] = await dbQuery('SELECT * FROM try_messages WHERE session_id = ? ORDER BY seq ASC', [r.id]);
    const messages = msgs.map((m) => ({
      seq: m.seq,
      id: m.id,
      time: m.time,
      role: m.role,
      sender: m.sender,
      isBuyer: !!m.is_buyer,
      isSystem: false,
      live: !!m.live,
      text: m.text,
      contentType: m.content_type,
      imagePath: null,
      imageUrl: m.image_url,
      sceneMajor: '',
      sceneMinor: '',
      orderId: '',
      ticketId: '',
      category: '',
      simulated: !!m.simulated,
    }));
    trySessions.set(r.id, {
      id: r.id,
      buyer: r.buyer,
      shop: r.shop,
      messages,
      order: null,
      tickets: [],
      buyerType: 'default',
      scenes: [],
      startTime: r.start_time,
      endTime: r.end_time,
      stats: {
        msgs: messages.length,
        buyerMsgs: messages.filter((m) => m.isBuyer).length,
        images: messages.filter((m) => m.contentType === '图片').length,
      },
      demo: null,
      tryMode: true,
    });
  }
}

export function getTrySession(id) {
  return trySessions.get(id) || null;
}

// 删除单条试跑记录（内存 + MySQL 级联：消息经外键级联，运行时记录显式删除）
export async function deleteTrySession(id) {
  if (!trySessions.has(id)) return false;
  trySessions.delete(id);
  await deleteTrySessionRow(id);
  return true;
}

// 清空全部试跑记录，返回被清空的 id 列表
export async function clearTrySessions() {
  const ids = [...trySessions.keys()];
  trySessions.clear();
  if (dbMode() === 'mysql') {
    await dbQuery('DELETE FROM try_sessions');
    await dbQuery("DELETE FROM runtime_actions WHERE session_id LIKE 'TRY%'");
    await dbQuery("DELETE FROM runtime_messages WHERE session_id LIKE 'TRY%'");
  }
  return ids;
}

// —— 人工发送的对话层（真实会话专用）：与 session.messages 隔离，不参与引擎分析与对账口径 ——
const chatExtras = new Map(); // sessionId -> messages[]
let extraSeq = 5000;

const nowStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function appendExtraMessages(sessionId, msgs) {
  if (!chatExtras.has(sessionId)) chatExtras.set(sessionId, []);
  const bucket = chatExtras.get(sessionId);
  const out = msgs.map((msg) => {
    const item = {
      seq: ++extraSeq,
      time: nowStr(),
      role: msg.role,
      sender: msg.sender,
      isBuyer: !!msg.isBuyer,
      isSystem: false,
      runtime: false,
      extra: true,
      live: !!msg.live,
      text: msg.text,
      contentType: '文本',
      imagePath: null,
      imageUrl: null,
      simulated: msg.simulated !== false,
    };
    bucket.push(item);
    return item;
  });
  return out;
}

export function extraMessages(sessionId) {
  return chatExtras.get(sessionId) || [];
}

export function trySessionList() {
  return [...trySessions.values()].reverse();
}
