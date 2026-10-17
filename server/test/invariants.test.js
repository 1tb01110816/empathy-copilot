// 工程不变量：赛题数据口径、试跑隔离、只演不做（动作只能人工触发）
// 独立进程运行；强制 JSON + 内存模式，避免测试触碰本机 MySQL 真实数据
process.env.DB_HOST = '';
process.env.APP_ACCESS_CODE = '';
process.env.DASHSCOPE_API_KEY = '';
process.env.API_RATE_MAX = '10000';
process.env.WRITE_RATE_MAX = '10000';
process.env.STREAM_RATE_MAX = '10000';
process.env.TRY_RATE_MAX = '100';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const {
  initStore, datasetStats, getAllSessions, getSession,
  createTrySession, deleteTrySession, appendExtraMessages, extraMessages, clearExtraMessages,
} = await import('../src/store.js');
const { insights } = await import('../src/engine/insights.js');
const { runPipeline } = await import('../src/pipeline.js');
const { buyerNextReaction } = await import('../src/engine/simulate.js');
const { runtimeActions, clearRuntime } = await import('../src/actions.js');
const { default: app } = await import('../src/app.js');

await initStore();

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const jsonPost = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('不变量：洞察只统计 138 条赛题会话，试跑与人工发送层不混入', async () => {
  const extrasBefore = extraMessages('S00010').length;
  appendExtraMessages('S00010', [
    { role: '客服', sender: '测试', isBuyer: false, text: '__AUTOTEST__ 人工发送层消息' },
  ]);
  const trySession = await createTrySession({ text: '__AUTOTEST__ 面膜用后泛红刺痒', buyerType: 'default' });
  try {
    const ins = insights();
    assert.equal(ins.perSession.length, 138);
    assert.ok(!ins.perSession.some((p) => p.id === trySession.id), '试跑会话不应进入洞察');
    assert.ok(!ins.perSession.some((p) => p.id.startsWith('TRY')), '洞察不应包含 TRY 会话');
    assert.equal(ins.stats.sessions, 138);
    assert.equal(ins.split.holdoutCount, 42);
    assert.equal(ins.riskCount.red + ins.riskCount.yellow + ins.riskCount.green, 138);
    assert.ok(ins.agreement.sceneStrict < 1, '严格一致率不应退回 100%');
    assert.ok(ins.holdoutAgreement.sceneStrict < 1, '留出集一致率不应为 100%');
    assert.equal(getAllSessions().length, 138);
  } finally {
    clearExtraMessages('S00010');
    assert.equal(extraMessages('S00010').length, 0);
    assert.equal(extrasBefore, 0, '测试前人工发送层应为空');
    clearRuntime(trySession.id);
    await deleteTrySession(trySession.id);
  }
});

test('不变量：138 / 998 / 487 / 29 / 113 / 80 / 112 口径稳定', () => {
  assert.deepEqual(datasetStats(), {
    sessions: 138,
    messages: 998,
    buyerMessages: 487,
    images: 29,
    orders: 113,
    tickets: 80,
    buyers: 112,
    sessionsWithOrder: 113,
    sessionsWithTicket: 80,
  });
});

test('只演不做：规则工作流与买家出演都不会执行动作', async () => {
  clearRuntime('S00010');
  const events = [];
  await runPipeline(getSession('S00010'), {
    uptoSeq: Infinity,
    mode: 'rules',
    emit: (e) => events.push(e),
    isAborted: () => false,
  });
  assert.ok(events.some((e) => e.type === 'done'), '工作流应正常结束');
  assert.equal(runtimeActions('S00010').length, 0, '流水线不得自动执行动作');

  const reaction = await buyerNextReaction({
    sceneKey: '不良反应/泛红刺痒',
    history: '买家：面膜用了脸发红\n客服：先停用观察',
    agentText: '先停用产品，24 小时内专员回访',
    priorLive: 0,
    usedTexts: [],
    buyerType: 'default',
  });
  assert.ok(reaction.text.length > 0);
  assert.equal(runtimeActions('S00010').length, 0, '买家出演不得触发动作');
});

test('接口入参：非法 ID / 动作 / payload / upto / 回复 / 试跑图片与画像均被拒绝', async () => {
  let res = await fetch(`${base}/sessions/bad%20id!`);
  assert.equal(res.status, 400);

  res = await jsonPost('/sessions/S00010/action', { type: '__not_an_action__' });
  assert.equal(res.status, 400);

  res = await jsonPost('/sessions/S00010/action', { type: 'register_adverse', payload: ['x'] });
  assert.equal(res.status, 400);

  res = await jsonPost('/sessions/S00010/action', { type: 'issue_coupon', payload: { amount: 'much' } });
  assert.equal(res.status, 400);

  res = await jsonPost('/sessions/S00010/action', { type: 'issue_coupon', payload: { amount: 99999 } });
  assert.equal(res.status, 400);

  res = await fetch(`${base}/sessions/S00010/stream?upto=abc`);
  assert.equal(res.status, 400);

  res = await jsonPost('/sessions/S00010/send', { text: '   ' });
  assert.equal(res.status, 400);

  res = await jsonPost('/try', { text: '测试', imageDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' });
  assert.equal(res.status, 400);

  res = await jsonPost('/try', { text: '测试', buyerType: '__not_a_type__' });
  assert.equal(res.status, 400);

  res = await jsonPost('/try', { text: 'x'.repeat(2001) });
  assert.equal(res.status, 400);
});

test('接口不变量：动作需人工执行，重置只清运行时层', async () => {
  appendExtraMessages('S00010', [
    { role: '客服', sender: '测试', isBuyer: false, text: '__AUTOTEST__ 待重置消息' },
  ]);
  let res = await jsonPost('/sessions/S00010/action', { type: 'register_adverse' });
  assert.equal(res.status, 200);
  assert.equal(runtimeActions('S00010').length, 1, '人工执行后应有 1 条动作');

  // 流水线重跑不应自动追加动作
  await runPipeline(getSession('S00010'), {
    uptoSeq: Infinity, mode: 'rules', emit: () => {}, isAborted: () => false,
  });
  assert.equal(runtimeActions('S00010').length, 1);

  res = await jsonPost('/sessions/S00010/reset', {});
  assert.equal(res.status, 200);
  assert.equal(runtimeActions('S00010').length, 0, '重置应清空运行时动作');
  assert.equal(extraMessages('S00010').length, 0, '重置应清空人工发送层');
  assert.equal(datasetStats().sessions, 138, '重置不得触碰赛题数据');
});

test('接口不变量：试跑会话隔离，删除/重置不影响真实会话', async () => {
  const badDelete = await fetch(`${base}/try/S00010`, { method: 'DELETE' });
  assert.equal(badDelete.status, 404, '删除接口不得删除真实会话');
  assert.ok(getSession('S00010'), '真实会话应仍然存在');

  const created = await (await jsonPost('/try', { text: '__AUTOTEST__ 面膜用后泛红刺痒' })).json();
  try {
    const reset = await jsonPost(`/sessions/${created.id}/reset`, {});
    assert.equal(reset.status, 400, '试跑会话应拒绝重置，只能删除重建');
  } finally {
    const del = await fetch(`${base}/try/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  }
});

test('接口不变量：试跑 demo 自动出演不产生动作', async () => {
  const res = await jsonPost('/try', { text: '__AUTOTEST__ 面膜用后泛红刺痒', demo: true });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  try {
    const detail = await (await fetch(`${base}/sessions/${id}`)).json();
    assert.equal(detail.runtime.actions.length, 0, '自动出演不得执行动作');
    assert.ok(detail.messages.some((m) => m.simulated), 'demo 应包含自动出演消息');
    assert.ok(detail.messages.length > 1);
  } finally {
    await fetch(`${base}/try/${id}`, { method: 'DELETE' });
  }
});
