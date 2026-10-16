// 引擎核心函数单测（node:test 内置，无需额外依赖）
// 覆盖：情绪打分/曲线、话术模板（含接情绪前缀）、买家画像出演模板
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreText, stateOf, buildEmotionCurve, W } from '../src/engine/emotion.js';
import { templateReply, stageReply, STAGE_LABELS, REPLY_TEMPLATES } from '../src/engine/analyze.js';
import { templateReaction, templateFollowup, BUYER_TYPES } from '../src/engine/simulate.js';

test('情绪打分：强情绪词显著抬分', () => {
  const calm = scoreText('请问这个商品有货吗');
  const angry = scoreText('你们太过分了！我要投诉！必须马上给我解决！！');
  assert.ok(calm.score < angry.score, `平静(${calm.score}) 应低于愤怒(${angry.score})`);
});

test('情绪打分：正向词与感谢压分', () => {
  const base = scoreText('你们怎么搞的');
  const thanks = scoreText('谢谢你们，真的很满意，太感谢了');
  assert.ok(thanks.score < base.score, `感谢(${thanks.score}) 应低于抱怨(${base.score})`);
});

test('情绪打分：范围限制 0-100', () => {
  const violent = scoreText('你们等着！我要投诉到底！！不要脸！！垃圾！！');
  assert.ok(violent.score >= 0 && violent.score <= 100);
});

test('情绪状态标签：阈值映射正确', () => {
  assert.equal(stateOf(10), '满意/情绪良好');
  assert.equal(stateOf(50), '明显不满/焦虑');
  assert.equal(stateOf(90), '激烈冲突');
  assert.equal(stateOf(null), '未知');
});

test('情绪曲线：EMA 平滑 + 峰值/当前/状态', () => {
  const msgs = [
    { seq: 1, isBuyer: true, text: '请问发货了吗' },
    { seq: 2, isBuyer: true, text: '怎么还没到，我很着急！' },
    { seq: 3, isBuyer: true, text: '你们太过分了，我要投诉！' },
  ];
  const c = buildEmotionCurve(msgs);
  assert.equal(c.points.length, 3);
  assert.ok(c.peak.value > c.points[0].value, '峰值应高于首点');
  assert.ok(c.current.value <= c.points[0].value * 2 + W.strong.cap, 'EMA 平滑不应极端');
  assert.notEqual(c.state, '未知');
});

test('情绪曲线：非买家消息不参与', () => {
  const c = buildEmotionCurve([{ seq: 1, isBuyer: false, text: '您好，有什么可以帮您' }]);
  assert.equal(c.points.length, 0);
});

test('话术模板：场景模板命中', () => {
  const r = templateReply('不良反应/泛红刺痒');
  assert.ok(r.includes('停用'), '不良反应话术应含停用建议');
  assert.ok(REPLY_TEMPLATES['售后退货/仅退款疑似异常']({}).includes('面单'));
});

test('话术模板：接情绪前缀只在强情绪时注入', () => {
  const plain = templateReply('物流异常/物流停滞疑似丢件', {});
  const calm = templateReply('物流异常/物流停滞疑似丢件', { emotionState: '平静' });
  const angry = templateReply('物流异常/物流停滞疑似丢件', { emotionState: '激烈冲突' });
  assert.equal(plain, calm, '平静状态不应注入前缀');
  assert.ok(angry.includes('交代'), '激烈冲突应注入前缀');
});

test('话术阶段：开场/跟进/收尾标签', () => {
  assert.equal(STAGE_LABELS.opening, '开场共情');
  assert.equal(STAGE_LABELS.followup, '跟进推进');
  assert.equal(STAGE_LABELS.closing, '收尾安抚');
  assert.ok(stageReply('不良反应/泛红刺痒', 'followup').includes('跟进'));
});

test('买家画像：画像模板优先于场景模板', () => {
  for (const key of ['urgent', 'hesitant', 'rational']) {
    const bt = BUYER_TYPES[key];
    assert.ok(bt.progress.length >= 2 && bt.closing.length >= 2, `${key} 画像应配齐出演模板`);
    const p = templateReaction('不良反应/泛红刺痒', 'progress', null, key);
    assert.ok(BUYER_TYPES[key].progress.includes(p), `${key} 出演应来自画像模板`);
  }
});

test('买家画像：默认画像回退场景模板且不重复', () => {
  const used = new Set();
  const a = templateReaction('不良反应/泛红刺痒', 'progress', used, 'default');
  used.add(a);
  const b = templateReaction('不良反应/泛红刺痒', 'progress', used, 'default');
  assert.notEqual(a, b, '去重后两条出演不应相同');
});

test('客服跟进话术：存在且非空', () => {
  assert.ok(templateFollowup('补发换货/错发色号').length > 10);
  assert.ok(templateFollowup('不存在的场景').length > 10);
});
