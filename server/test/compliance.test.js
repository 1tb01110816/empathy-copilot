import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCompliance, filterReply } from '../src/llm/compliance.js';
import { recordLlmCall, llmUsage, resetLlmUsage } from '../src/llm/telemetry.js';
import { REPLY_TEMPLATES } from '../src/engine/analyze.js';

test('合规扫描：识别医疗建议 / 功效保证 / 超权限赔付 / 站外交易 / 隐私收集', () => {
  const cases = [
    ['建议您口服药配合药膏治疗', 'medical_advice'],
    ['保证三天见效，百分百有效', 'cure_guarantee'],
    ['我们给您全额赔付', 'over_compensation'],
    ['您加我微信私下转账', 'off_platform'],
    ['请提供身份证号和短信验证码', 'privacy'],
  ];
  for (const [text, code] of cases) {
    const hits = scanCompliance(text);
    assert.ok(hits.some((h) => h.code === code), `${text} 应命中 ${code}`);
    assert.ok(hits.every((h) => h.label && h.match), '命中项应带标签与原文');
  }
});

test('合规扫描：安全话术不误伤', () => {
  const safe = [
    '请立即停用该产品，用清水洁面并做好基础保湿，若加重请及时就医。',
    '这边为您登记不良反应记录单，专员 24 小时内回访。',
    '若核实确为漏发，第一时间为您补发或退款，绝不让您吃亏。',
    '请您先不要丢弃外箱和快递面单，拍摄外箱六面与内件照片。',
  ];
  for (const text of safe) assert.deepEqual(scanCompliance(text), [], `不应命中：${text}`);
});

test('话术过滤：命中即整段替换为规则安全话术', () => {
  const fallback = '规则安全话术';
  const clean = filterReply('亲亲，已为您登记并安排回访。', fallback);
  assert.equal(clean.filtered, false);
  assert.equal(clean.text, '亲亲，已为您登记并安排回访。');
  assert.deepEqual(clean.violations, []);

  const unsafe = filterReply('放心，保证治好，我们马上赔付。', fallback);
  assert.equal(unsafe.filtered, true);
  assert.equal(unsafe.text, fallback);
  assert.ok(unsafe.violations.length >= 2);
});

test('全部规则话术模板通过合规扫描（兜底话术自身必须安全）', () => {
  for (const [scene, fn] of Object.entries(REPLY_TEMPLATES)) {
    const hits = scanCompliance(fn({ coupon: '50 元', amount: 120, urgent: true }));
    assert.deepEqual(hits, [], `${scene} 模板命中合规规则：${hits.map((h) => h.label).join('、')}`);
  }
});

test('LLM 遥测：按 kind/model 累计 token 与耗时，重置后归零', () => {
  resetLlmUsage();
  recordLlmCall({ kind: 'script', model: 'qwen-plus', ms: 120, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
  recordLlmCall({ kind: 'script', model: 'qwen-plus', ms: 80, usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }, ok: false });
  recordLlmCall({ kind: 'vision', model: 'qwen-vl-max', ms: 300, usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } });

  const usage = llmUsage();
  assert.equal(usage.calls, 3);
  assert.equal(usage.ok, 2);
  assert.equal(usage.failed, 1);
  assert.equal(usage.totalTokens, 230);
  assert.equal(usage.totalMs, 500);
  assert.equal(usage.byKind.script.calls, 2);
  assert.equal(usage.byKind.script.failed, 1);
  assert.equal(usage.byModel['qwen-vl-max'].totalTokens, 50);

  usage.calls = 999;
  assert.equal(llmUsage().calls, 3, 'llmUsage 应返回快照副本');

  resetLlmUsage();
  assert.equal(llmUsage().calls, 0);
  assert.equal(llmUsage().totalTokens, 0);
});
