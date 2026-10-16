import { Router } from 'express';
import { getSession, sessionList, DEMO_SESSIONS, datasetStats, createTrySession, trySessionList, appendTryMessages, appendExtraMessages, extraMessages, getTrySession, deleteTrySession, clearTrySessions, searchOrders, searchTickets } from '../store.js';
import { ruleAnalyze } from '../engine/analyze.js';
import { demoDialogue, buyerNextReaction } from '../engine/simulate.js';
import { insights } from '../engine/insights.js';
import { runPipeline } from '../pipeline.js';
import { executeAction, runtimeActions, runtimeMessages, ACTION_DEFS, clearRuntime } from '../actions.js';
import { llmAvailable, textModel, vlModel } from '../llm/qwen.js';
import { dbStatus } from '../db.js';

const api = Router();

// —— 写接口轻量限流：站点已公网可访问，防止被脚本批量刷写试跑/动作记录（内存计数，单实例演示足够，不影响正常操作）——
const writeBuckets = new Map(); // ip -> { count, ts }
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const ip = String(req.headers['x-forwarded-for']?.split(',')[0] || '').trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const b = writeBuckets.get(ip);
  if (!b || now - b.ts > 60000) {
    writeBuckets.set(ip, { count: 1, ts: now });
  } else if (b.count >= 60) {
    return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
  } else {
    b.count += 1;
  }
  next();
});

api.get('/health', (req, res) => {
  res.json({ ok: true, llm: llmAvailable(), textModel: textModel(), vlModel: vlModel(), storage: dbStatus() });
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
  res.json({ items: searchOrders(String(req.query.q || '')) });
});
api.get('/refs/tickets', (req, res) => {
  res.json({ items: searchTickets(String(req.query.q || '')) });
});

// 试跑：现场输入买家问题（文本 + 可选图片 + 可选关联订单/工单 + 可选买家画像）→ 临时会话，走同一引擎与 Agent 工作流
// demo=true：自动出演「客服共情回复 + 买家收到回复后的反应」（仅追加演示对话，不执行任何动作）
api.post('/try', async (req, res) => {
  try {
    const { text, imageDataUrl, demo, orderId, ticketId, buyerType } = req.body || {};
    const t = String(text || '').trim();
    if (!t && !imageDataUrl) throw Object.assign(new Error('请至少输入买家消息或上传一张图片'), { status: 400 });
    if (t.length > 2000) throw Object.assign(new Error('文本过长（最多 2000 字）'), { status: 400 });
    if (imageDataUrl) {
      if (!String(imageDataUrl).startsWith('data:image/')) throw Object.assign(new Error('图片格式不支持'), { status: 400 });
      if (String(imageDataUrl).length > 3 * 1024 * 1024) throw Object.assign(new Error('图片过大（压缩后仍超过 3MB）'), { status: 400 });
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
api.get('/sessions/:id/stream', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const uptoSeq = req.query.upto ? Number(req.query.upto) : Infinity;
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
    const result = await executeAction(req.params.id, type, payload);
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

api.get('/insights', (req, res) => {
  res.json(insights());
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
