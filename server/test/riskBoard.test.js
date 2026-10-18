// 风险看板：信号聚合口径、状态跟踪隔离、赛题数据不被污染
// 独立进程运行；强制 JSON + 内存模式，避免测试触碰本机 MySQL 真实数据
process.env.DB_HOST = '';
process.env.APP_ACCESS_CODE = '';
process.env.DASHSCOPE_API_KEY = '';
process.env.API_RATE_MAX = '10000';
process.env.WRITE_RATE_MAX = '10000';
process.env.STREAM_RATE_MAX = '10000';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { initStore, datasetStats } = await import('../src/store.js');
const { buildRiskBoard } = await import('../src/engine/riskBoard.js');
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

const patchAlert = (id, body) =>
  fetch(`${base}/risk-board/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('信号聚合：四类信号去重为 26 条预警，否定式与数字串不误报', () => {
  const board = buildRiskBoard();
  assert.equal(board.stats.sessions, 138);
  assert.equal(board.alerts.length, 26);
  assert.equal(board.stats.total, 26);
  assert.equal(board.stats.complaints, 8);
  assert.equal(board.stats.repeatVisits, 6);
  assert.equal(board.stats.emotions, 9);
  assert.equal(board.stats.repeatRefunds, 8);
  assert.equal(board.stats.urgent + board.stats.high + board.stats.medium, 26);
  assert.equal(new Set(board.alerts.map((a) => a.id)).size, 26, '预警 ID 必须唯一');
  assert.ok(board.alerts.every((a) => a.id === `RA-${a.sessionId}`));
  assert.ok(board.alerts.every((a) => a.signals.length > 0), '每条预警至少一个信号');
  assert.ok(board.alerts.every((a) => a.status === 'pending' && a.owner === '' && a.note === ''));

  const byId = new Map(board.alerts.map((a) => [a.sessionId, a]));

  const fraud = byId.get('S00024');
  assert.ok(fraud, '空包裹仅退款会话应进入预警');
  assert.ok(fraud.signals.some((s) => s.key === 'complaint'));
  assert.equal(fraud.riskLevel, 'red');
  assert.equal(fraud.severity, 'urgent');

  assert.ok(byId.get('S00059').signals.some((s) => s.key === 'repeatVisit'));
  assert.ok(byId.get('S00003').signals.some((s) => s.key === 'emotion'));
  assert.ok(byId.get('S00029').signals.some((s) => s.key === 'repeatRefund'));
  assert.ok(byId.get('S00064').signals.some((s) => s.key === 'complaint'), '「不然我投诉」应视为真实升级意向');

  assert.ok(!byId.has('S00065'), '「就不投诉了」等否定式不应触发舆情信号');
  assert.ok(!byId.has('S00141'), '订单号中的 315 数字串不应误判');
});

test('接口：状态流转与负责人/备注可持久化，入参校验生效', async () => {
  const statsBefore = datasetStats();

  let res = await fetch(`${base}/risk-board`);
  assert.equal(res.status, 200);
  const board = await res.json();
  assert.equal(board.alerts.length, 26);
  assert.equal(board.stats.byStatus.pending, 26);
  const target = board.alerts.find((a) => a.sessionId === 'S00024');
  assert.ok(target);
  assert.equal(target.status, 'pending');

  res = await patchAlert(target.id, { status: 'following', owner: '值班组长', note: '已电话联系买家' });
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.equal(saved.state.status, 'following');
  assert.equal(saved.state.owner, '值班组长');
  assert.ok(saved.state.updatedAt);

  const after = await (await fetch(`${base}/risk-board`)).json();
  const updated = after.alerts.find((a) => a.id === target.id);
  assert.equal(updated.status, 'following');
  assert.equal(updated.note, '已电话联系买家');
  assert.equal(after.stats.byStatus.following, 1);
  assert.equal(after.stats.byStatus.pending, 25);

  assert.deepEqual(datasetStats(), statsBefore, '看板写操作不得改变 138 条赛题数据');

  assert.equal((await patchAlert(target.id, { status: 'done' })).status, 400);
  assert.equal((await patchAlert(target.id, { note: 'x'.repeat(201) })).status, 400);
  assert.equal((await patchAlert(target.id, {})).status, 400);
  assert.equal((await patchAlert('RA-S99999', { status: 'closed' })).status, 404);
  assert.equal((await patchAlert('bad id!', { status: 'closed' })).status, 400);

  res = await patchAlert(target.id, { status: 'pending', owner: '', note: '' });
  assert.equal(res.status, 200);
  const restored = await (await fetch(`${base}/risk-board`)).json();
  assert.equal(restored.alerts.find((a) => a.id === target.id).status, 'pending');
  assert.equal(restored.stats.byStatus.pending, 26);
  assert.equal(restored.stats.byStatus.following, 0);
});
