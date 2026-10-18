import { Router } from 'express';
import { getSession, sessionList, DEMO_SESSIONS, datasetStats, createTrySession, trySessionList, appendTryMessages, appendExtraMessages, extraMessages, clearExtraMessages, getTrySession, deleteTrySession, clearTrySessions, searchOrders, searchTickets } from '../store.js';
import { ruleAnalyze } from '../engine/analyze.js';
import { demoDialogue, buyerNextReaction, BUYER_TYPES } from '../engine/simulate.js';
import { insights } from '../engine/insights.js';
import { buildRiskBoard } from '../engine/riskBoard.js';
import { loadRiskStates, saveRiskState, applyRiskStates, RISK_STATUSES } from '../riskState.js';
import { runPipeline } from '../pipeline.js';
import { executeAction, runtimeActions, runtimeMessages, ACTION_DEFS, clearRuntime } from '../actions.js';
import { llmAvailable, textModel, vlModel } from '../llm/qwen.js';
import { llmUsage } from '../llm/telemetry.js';
import { dbStatus } from '../db.js';
import { accessEnabled, createRateLimiter } from '../security.js';

const api = Router();

// 限流：全接口兜底 + 写接口更严；健康检查与预检不受限（内存计数，单实例演示足够）
const skipHealth = (req) => req.path === '/health' || req.method === 'OPTIONS';
const apiLimiter = createRateLimiter({
  max: Number(process.env.API_RATE_MAX || 240),
  windowMs: Number(process.env.API_RATE_WINDOW_MS || 60_000),
  skip: skipHealth,
});
const writeLimiter = createRateLimiter({
  max: Number(process.env.WRITE_RATE_MAX || 60),
  message: '操作过于频繁，请稍后再试',
  skip: (req) => skipHealth(req) || req.method === 'GET' || req.method === 'HEAD',
});
const streamLimiter = createRateLimiter({
  max: Number(process.env.STREAM_RATE_MAX || 20),
  message: '分析请求过于频繁，请稍后再试',
});
const tryLimiter = createRateLimiter({
  max: Number(process.env.TRY_RATE_MAX || 10),
  message: '试跑创建过于频繁，请稍后再试',
});
api.use(apiLimiter);
api.use(writeLimiter);

// 会话 ID 仅允许字母/数字/下划线/中划线，长度受限；非法入参在进入业务前直接拒绝
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
api.param('id', (req, res, next, id) => {
  if (!ID_RE.test(id)) return res.status(400).json({ error: '非法会话 ID' });
  next();
});

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// 动作 payload 仅接受小体积普通对象，金额/加急标记做类型与范围校验
function validateActionPayload(payload) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('动作 payload 必须是对象');
  if (JSON.stringify(payload).length > 2048) throw badRequest('动作 payload 过大');
  if ('amount' in payload && (!Number.isFinite(payload.amount) || payload.amount < 0 || payload.amount > 5000)) {
    throw badRequest('金额必须是 0–5000 的数字');
  }
  if ('urgent' in payload && typeof payload.urgent !== 'boolean') throw badRequest('urgent 必须是布尔值');
  return payload;
}

api.get('/health', (req, res) => {
  res.json({ ok: true, auth: accessEnabled(), llm: llmAvailable(), textModel: textModel(), vlModel: vlModel(), storage: dbStatus() });
});

api.get('/overview', (req, res) => {
  const ins = insights();
  res.json({
    stats: datasetStats(),
    llm: { available: llmAvailable(), textModel: textModel(), vlModel: vlModel() },
    storage: dbStatus(),
    demo: DEMO_SESSIONS,
    riskCount: ins.riskCount,
    agreement: ins.agreement,
    actions: Object.entries(ACTION_DEFS).map(([type, def]) => ({ type, label: def.label })),
  });
});

// LLM 调用可观测性：进程内累计调用次数 / token / 耗时（重启归零，演示实例足够）
api.get('/llm/usage', (req, res) => {
  res.json(llmUsage());
});

api.get('/sessions', (req, res) => {
  const ins = insights();
  const riskMap = new Map(ins.perSession.map((p) => [p.id, p]));
  const demoOrder = new Map(DEMO_SESSIONS.map((d, i) => [d.id, i]));
  const list = sessionList()
    .map((s) => ({
      ...s,
      riskLevel: riskMap.get(s.id)?.level || 'green',
      riskPeak: riskMap.get(s.id)?.peak ?? 0,
      engineScene: riskMap.get(s.id)?.sceneKey || '',
    }))
    .sort((a, b) => {
      const da = demoOrder.has(a.id), db = demoOrder.has(b.id);
      if (da !== db) return da ? -1 : 1;
      if (da && db) return demoOrder.get(a.id) - demoOrder.get(b.id);
      return b.startTime.localeCompare(a.startTime);
    });
  const tryList = trySessionList().map((s) => {
    const a = ruleAnalyze(s);
    const [major = '', minor = ''] = (a.sceneKey || '').split('/');
    const lastBuyerMsg = [...s.messages].reverse().find((m) => m.isBuyer && !m.simulated);
    return {
      id: s.id,
      buyer: s.buyer,
      startTime: s.startTime,
      endTime: s.endTime,
      sceneKey: a.sceneKey,
      sceneMajor: major,
      sceneMinor: minor,
      msgs: s.stats.msgs,
      images: s.stats.images,
      hasOrder: !!s.order,
      ticketKinds: s.tickets.map((t) => t.kind),
      buyerType: s.buyerType || 'default',
      preview: lastBuyerMsg ? lastBuyerMsg.text.slice(0, 40) : '',
      demo: null,
      riskLevel: a.risk.level,
      riskPeak: a.emotion.peak?.value ?? 0,
      engineScene: a.sceneKey,
      tryMode: true,
    };
  });
  res.json({ sessions: [...tryList, ...list], total: tryList.length + list.length });
});

// 试跑「可选关联」搜索：从赛题 MOCK 库检索订单 / 工单（关键词：订单号/商品/买家/物流单号等）
api.get('/refs/orders', (req, res) => {
  res.json({ items: searchOrders(String(req.query.q || '').slice(0, 100)) });
});
api.get('/refs/tickets', (req, res) => {
  res.json({ items: searchTickets(String(req.query.q || '').slice(0, 100)) });
});

// 试跑：现场输入买家问题（文本 + 可选图片 + 可选关联订单/工单 + 可选买家画像）→ 临时会话，走同一引擎与 Agent 工作流
// demo=true：自动出演「客服共情回复 + 买家收到回复后的反应」（仅追加演示对话，不执行任何动作）
api.post('/try', tryLimiter, async (req, res) => {
  try {
    const { text, imageDataUrl, demo, orderId, ticketId, buyerType } = req.body || {};
    const t = String(text || '').trim();
    if (!t && !imageDataUrl) throw badRequest('请至少输入买家消息或上传一张图片');
    if (t.length > 2000) throw badRequest('文本过长（最多 2000 字）');
    if (demo !== undefined && typeof demo !== 'boolean') throw badRequest('demo 必须是布尔值');
    if (orderId && String(orderId).length > 64) throw badRequest('订单号过长');
    if (ticketId && String(ticketId).length > 64) throw badRequest('工单号过长');
    if (buyerType !== undefined && !BUYER_TYPES[String(buyerType)]) throw badRequest('未知买家画像');
    if (imageDataUrl) {
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(imageDataUrl))) throw badRequest('图片格式不支持');
      if (String(imageDataUrl).length > 3 * 1024 * 1024) throw badRequest('图片过大（压缩后仍超过 3MB）');
    }
    const session = await createTrySession({
      text: t,
      imageDataUrl: imageDataUrl || null,
      orderId: orderId ? String(orderId) : null,
      ticketId: ticketId ? String(ticketId) : null,
      buyerType: String(buyerType || 'default'),
    });
    if (demo) {
      const analysis = ruleAnalyze(session);
      await appendTryMessages(session, await demoDialogue(session, analysis));
    }
    res.json({ id: session.id });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

api.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const analysis = ruleAnalyze(session);
  const runtimeMsgs = runtimeMessages(session.id);
  const extraMsgs = extraMessages(session.id);
  const messages = [...session.messages, ...runtimeMsgs, ...extraMsgs].sort(
    (a, b) => String(a.time).localeCompare(String(b.time)) || a.seq - b.seq,
  );
  res.json({
    id: session.id,
    buyer: session.buyer,
    shop: session.shop,
    startTime: session.startTime,
    endTime: session.endTime,
    stats: session.stats,
    demo: session.demo,
    scenes: session.scenes,
    messages,
    order: session.order,
    tickets: session.tickets,
    analysis,
    runtime: {
      actions: runtimeActions(session.id),
      actionDefs: Object.entries(ACTION_DEFS).map(([type, def]) => ({ type, label: def.label })),
    },
  });
});

// SSE：Agent 工作流事件流（步骤 / 中间结果 / 流式话术 / 最终分析）
api.get('/sessions/:id/stream', streamLimiter, async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  let uptoSeq = Infinity;
  if (req.query.upto !== undefined) {
    uptoSeq = Number(req.query.upto);
    if (!Number.isInteger(uptoSeq) || uptoSeq < 1 || uptoSeq > 1_000_000) {
      return res.status(400).json({ error: 'upto 必须是 1–1000000 的整数' });
    }
  }
  const mode = req.query.mode === 'agent' ? 'agent' : 'rules';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  let aborted = false;
  const heartbeat = setInterval(() => {
    if (!aborted) res.write(': ping\n\n');
  }, 15000);
  req.on('close', () => {
    aborted = true;
    clearInterval(heartbeat);
  });

  const emit = (event) => {
    if (aborted) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { /* 连接已断 */ }
  };

  try {
    await runPipeline(session, { uptoSeq, mode, emit, isAborted: () => aborted || res.writableEnded });
  } catch (e) {
    emit({ type: 'error', message: String(e.message || e).slice(0, 200) });
  } finally {
    clearInterval(heartbeat);
    if (!aborted) res.end();
  }
});

api.post('/sessions/:id/action', async (req, res) => {
  try {
    const { type, payload } = req.body || {};
    if (!ACTION_DEFS[type]) throw badRequest('未知动作类型');
    const result = await executeAction(req.params.id, type, validateActionPayload(payload));
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// 人工发送回复（采纳并发送 / 手动回复）→ 买家侧自动出演一条回应，多轮直至买家确认解决（只演不做）
api.post('/sessions/:id/send', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    const text = String(req.body?.text || '').trim();
    if (!text) throw Object.assign(new Error('回复内容不能为空'), { status: 400 });
    if (text.length > 1000) throw Object.assign(new Error('回复过长（最多 1000 字）'), { status: 400 });

    const analysis = ruleAnalyze(session);
    const exts = extraMessages(session.id);
    const allMsgs = [...session.messages, ...exts];
    const priorLive = (session.tryMode ? session.messages : exts).filter((m) => m.live).length;
    const agent = { role: '客服', sender: `${session.shop}:客服`, isBuyer: false, text, live: true, simulated: false };
    // 买家已确认解决（人工发送满 2 轮）：本轮发送即收尾告别，买家不再出演回复（只演不做，闭环终止）
    if (priorLive >= 2) {
      if (session.tryMode) await appendTryMessages(session, [agent]);
      else appendExtraMessages(session.id, [agent]);
      return res.json({ ok: true, ended: true, resolved: true, source: 'closed' });
    }
    const history = allMsgs
      .slice(-8)
      .map((m) => `${m.isBuyer ? '买家' : '客服'}：${String(m.text).slice(0, 80)}`)
      .join('\n');
    const usedTexts = allMsgs.filter((m) => m.isBuyer).map((m) => String(m.text || ''));
    const reaction = await buyerNextReaction({
      sceneKey: analysis.sceneKey,
      history,
      agentText: text,
      priorLive,
      usedTexts,
      buyerType: session.buyerType || 'default',
    });
    // 人工发送触发的出演按正常对话显示（不带「演示模拟」徽标），与试跑自动播放的消息区分
    const buyer = { role: '买家', sender: '买家', isBuyer: true, text: reaction.text, simulated: false };
    if (session.tryMode) await appendTryMessages(session, [agent, buyer]);
    else appendExtraMessages(session.id, [agent, buyer]);
    res.json({ ok: true, resolved: reaction.resolved, source: reaction.source });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// 一键重置演示状态：仅清空真实演示会话的运行时动作/消费者回执与人工发送对话层，不触碰赛题 138 条数据
// 试跑会话请走 DELETE /api/try/:id 删除重建
api.post('/sessions/:id/reset', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.tryMode) {
      return res.status(400).json({ error: '试跑会话请直接在列表删除后重建（避免混入历史出演消息）' });
    }
    clearExtraMessages(session.id);
    clearRuntime(session.id);
    res.json({ ok: true, id: session.id });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

api.get('/insights', (req, res) => {
  res.json(insights());
});

// 跨会话风险预警看板：只读聚合 138 条赛题会话 + 独立状态跟踪（不改动原始数据）
api.get('/risk-board', async (req, res) => {
  try {
    const board = buildRiskBoard();
    const states = await loadRiskStates();
    res.json(applyRiskStates(board, states));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const RISK_STATUS_SET = new Set(RISK_STATUSES);
const RISK_MAX = { owner: 24, note: 200 };

function validateRiskPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('状态参数必须是对象');
  const patch = {};
  if ('status' in body) {
    if (!RISK_STATUS_SET.has(body.status)) throw badRequest('状态必须是 pending / following / closed');
    patch.status = body.status;
  }
  for (const field of ['owner', 'note']) {
    if (!(field in body)) continue;
    if (typeof body[field] !== 'string') throw badRequest(`${field} 必须是字符串`);
    const value = body[field].trim();
    if (value.length > RISK_MAX[field]) throw badRequest(`${field} 过长（最多 ${RISK_MAX[field]} 字）`);
    patch[field] = value;
  }
  if (!Object.keys(patch).length) throw badRequest('至少提交一个状态字段');
  return patch;
}

api.patch('/risk-board/:id', async (req, res) => {
  try {
    const alert = buildRiskBoard().alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'risk alert not found' });
    const patch = validateRiskPatch(req.body || {});
    const state = await saveRiskState(alert.id, patch);
    res.json({ ok: true, state });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// 试跑记录删除（单条）：仅影响 TRY 前缀试跑会话与其运行时记录，不触碰赛题 138 条数据
api.delete('/try/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const session = getTrySession(id);
    if (!session) return res.status(404).json({ error: 'try session not found' });
    await deleteTrySession(id);
    clearRuntime(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// 试跑记录清空（全部）
api.delete('/try', async (req, res) => {
  try {
    const ids = trySessionList().map((s) => s.id);
    await clearTrySessions();
    for (const id of ids) clearRuntime(id);
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

export default api;
