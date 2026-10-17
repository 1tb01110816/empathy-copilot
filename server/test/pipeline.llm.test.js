import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// 本地 mock DashScope：让 Agent 工作流在无真实 Key 的 CI 中也能跑通
// 场景一：模型返回违规话术 → 必须被合规过滤替换，且违规原文不得流式播给用户
// 场景二：模型返回安全话术 → 正常采用
function startMockLlm() {
  const state = { unsafe: true };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const prompt = JSON.stringify(body.messages || []);
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const reply = state.unsafe
          ? '放心，保证三天见效，我们马上赔付，您加微信详聊。'
          : '亲亲，已为您登记并安排专员 24 小时内回访，请放心。';
        const text = JSON.stringify({ reply, tone: '安抚+方案', notes: [] });
        for (let i = 0; i < text.length; i += 12) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 12) } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const content = prompt.includes('情绪分析器')
        ? JSON.stringify({ scores: [{ seq: 1, score: 40, note: 'mock' }] })
        : JSON.stringify({ headline: 'mock 摘要', focus: ['mock 关注点'], reasoning: 'mock 融合' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

test('Agent 合规链路：违规话术被拦截替换，流式只播安全文本；token 遥测完整', async () => {
  const { server, state, port } = await startMockLlm();
  const saved = { base: process.env.DASHSCOPE_BASE_URL, key: process.env.DASHSCOPE_API_KEY };
  process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.DASHSCOPE_API_KEY = 'test-key';
  try {
    const { initStore, getSession } = await import('../src/store.js');
    await initStore();
    const session = getSession('S00010');
    assert.ok(session, '演示会话 S00010 应存在');

    const { runPipeline } = await import('../src/pipeline.js');

    // —— 场景一：违规输出 ——
    const events = [];
    const analysis = await runPipeline(session, { mode: 'agent', emit: (e) => events.push(e) });
    assert.equal(analysis.engine, 'agent');
    assert.equal(analysis.complianceFilter.filtered, true);
    assert.ok(analysis.complianceFilter.violations.length >= 2, '应命中功效保证与超权限赔付');
    assert.equal(analysis.reply.source, 'rules（合规兜底）');
    assert.ok(analysis.reply.notes.some((n) => n.includes('合规边界')), '话术需带合规替换提示');

    const deltas = events.filter((e) => e.type === 'reply_delta').map((e) => e.text);
    assert.ok(deltas.length > 0, '应有流式回放');
    assert.ok(deltas.every((t) => !t.includes('保证三天见效') && !t.includes('加微信')), '违规原文不得流式出现');
    assert.ok(deltas.at(-1).includes('停用该产品'), '最终流式文本应为规则安全话术');

    const steps = events.filter((e) => e.type === 'step');
    assert.equal(steps.find((s) => s.id === 'compliance')?.status, 'fallback');
    assert.equal(analysis.llmTelemetry.length, 3, '情绪复评 + 摘要 + 话术三次调用');
    assert.deepEqual(analysis.llmTelemetry.map((c) => c.kind).sort(), ['emotion', 'script', 'summary']);
    assert.equal(analysis.llmTelemetry.reduce((n, c) => n + c.totalTokens, 0), 80, '10+5 + 10+5 + 30+20');
    assert.ok(analysis.llmTelemetry.every((c) => c.model && c.ms >= 0), '每次调用应记录模型与耗时');

    // —— 场景二：安全输出 ——
    state.unsafe = false;
    const safe = await runPipeline(session, { mode: 'agent', emit: () => {} });
    assert.equal(safe.complianceFilter.filtered, false);
    assert.equal(safe.complianceFilter.violations.length, 0);
    assert.ok(safe.reply.source.startsWith('qwen · '), '安全话术应保留模型来源');
    assert.ok(safe.reply.text.includes('24 小时内回访'));
  } finally {
    if (saved.base === undefined) delete process.env.DASHSCOPE_BASE_URL;
    else process.env.DASHSCOPE_BASE_URL = saved.base;
    if (saved.key === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = saved.key;
    await new Promise((r) => server.close(r));
  }
});
