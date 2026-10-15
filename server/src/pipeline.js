// AI Agent 工作流：感知(多源融合) → 并行分析(意图/情绪/风险/多模态) → 决策(话术) → 对账
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleAnalyze, STAGE_LABELS } from './engine/analyze.js';
import { blendCurves } from './engine/emotion.js';
import { llmAvailable, chatJson, chatStream, visionJson, textModel, vlModel } from './llm/qwen.js';
import { scriptMessages, summaryMessages, emotionMessages, evidencePrompt, EVIDENCE_FALLBACK } from './llm/prompts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMAGE_DIR = path.join(ROOT, 'web', 'public', 'mock_images');

function imageCategory(imagePath) {
  const m = /^mock_images\/([^/]+)\//.exec(imagePath || '');
  return m ? m[1] : null;
}

function loadImageDataUrl(category) {
  const file = path.join(IMAGE_DIR, `${category}.jpg`);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length > 4 * 1024 * 1024) return null;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export async function runPipeline(session, { uptoSeq = Infinity, mode = 'agent', emit = () => {}, isAborted = () => false }) {
  const started = Date.now();
  const step = (id, label, status, detail) => emit({ type: 'step', id, label, status, detail, ms: Date.now() - started });
  const ensureAlive = () => {
    if (isAborted()) throw new Error('client_aborted');
  };

  const base = ruleAnalyze(session, uptoSeq);
  const llm = llmAvailable();
  const useLLM = mode === 'agent' && llm;

  step('perceive', '感知 · 多源数据融合', 'done',
    base.fusion.sources.map((s) => `${s.label}${s.ok ? '✓' : '—'}`).join('，'));
  emit({ type: 'partial', key: 'fusion', value: base.fusion });
  ensureAlive();

  step('intent', '分析 · 意图识别', 'done',
    base.intent.dominant[0] ? `${base.intent.dominant[0].major}/${base.intent.dominant[0].minor}（${base.intent.dominant[0].count}条）` : '未识别');
  emit({ type: 'partial', key: 'intent', value: base.intent });
  ensureAlive();

  step('emotion', '分析 · 会话级情绪曲线', 'done',
    `峰值 ${base.emotion.peak?.value ?? '-'} / 当前 ${base.emotion.current?.value ?? '-'}（${base.emotion.state}）`);
  emit({ type: 'partial', key: 'emotion', value: base.emotion });
  ensureAlive();

  step('risk', '分析 · 风险分级', 'done', `${base.risk.level.toUpperCase()} · ${base.risk.reasons[0] || ''}`);
  emit({ type: 'partial', key: 'risk', value: base.risk });
  ensureAlive();

  // —— 多模态证据理解 ——
  const lastImage = [...session.messages].reverse()
    .find((m) => m.seq <= base.uptoSeq && m.contentType === '图片');
  let evidence = null;
  if (lastImage) {
    const uploaded = lastImage.imageUrl?.startsWith('data:') ? lastImage.imageUrl : null;
    const category = uploaded ? 'upload' : (imageCategory(lastImage.imagePath) || 'unknown');
    step('evidence', '分析 · 多模态证据理解', 'running', lastImage.imagePath || '买家上传图片');
    const dataUrl = uploaded || loadImageDataUrl(category);
    if (useLLM && dataUrl) {
      try {
        const p = evidencePrompt(category);
        const { json } = await visionJson({ prompt: `${p.system}\n\n${p.user}`, imageDataUrl: dataUrl });
        evidence = { source: `qwen-vl · ${vlModel()}`, category, imageUrl: lastImage.imageUrl, seq: lastImage.seq, ...json };
        step('evidence', '分析 · 多模态证据理解', 'done', `${evidence.verdict}（${vlModel()}）`);
      } catch (e) {
        evidence = { source: 'rules-fallback', category, imageUrl: lastImage.imageUrl, seq: lastImage.seq, ...(EVIDENCE_FALLBACK[category] || EVIDENCE_FALLBACK.consult_card), error: String(e.message).slice(0, 120) };
        step('evidence', '分析 · 多模态证据理解', 'fallback', '通义千问调用失败，使用规则兜底');
      }
    } else {
      evidence = { source: llm ? 'rules（图片文件缺失）' : 'rules（未启用通义千问）', category, imageUrl: lastImage.imageUrl, seq: lastImage.seq, ...(EVIDENCE_FALLBACK[category] || EVIDENCE_FALLBACK.consult_card) };
      step('evidence', '分析 · 多模态证据理解', llm ? 'fallback' : 'rules',
        llm ? '证据图片未随赛题材料提供，使用规则口径兜底' : '未配置 DASHSCOPE_API_KEY，规则口径兜底');
    }
    emit({ type: 'partial', key: 'evidence', value: evidence });
    ensureAlive();
  }

  // —— LLM 深度分析 ——
  let emotion = base.emotion;
  let summary = { headline: base.summary, focus: base.risk.reasons.slice(0, 3), source: 'rules' };
  let reply = { text: base.reply, source: 'rules（模板）', notes: base.risk.compliance };
  emit({ type: 'partial', key: 'summary', value: summary });
  emit({ type: 'partial', key: 'reply', value: reply });

  if (useLLM) {
    // 情绪复评
    step('llm_emotion', `通义千问 · 情绪复评（${textModel()}）`, 'running');
    try {
      const p = emotionMessages(base, session);
      const { json } = await chatJson({ system: p.system, user: p.user, maxTokens: 800, timeoutMs: 45000 });
      const scores = (json.scores || []).map((s) => ({ seq: Number(s.seq), score: Number(s.score) })).filter((s) => Number.isFinite(s.seq) && Number.isFinite(s.score));
      if (scores.length) {
        emotion = blendCurves(base.emotion, scores);
        step('llm_emotion', `通义千问 · 情绪复评（${textModel()}）`, 'done', `${scores.length} 条买家消息已复评`);
        emit({ type: 'partial', key: 'emotion', value: emotion });
      } else {
        step('llm_emotion', '通义千问 · 情绪复评', 'fallback', '模型未返回有效分数');
      }
    } catch (e) {
      step('llm_emotion', '通义千问 · 情绪复评', 'fallback', String(e.message).slice(0, 100));
    }
    ensureAlive();

    // 摘要
    step('summary', `通义千问 · 5秒摘要（${textModel()}）`, 'running');
    try {
      const p = summaryMessages({ ...base, emotion }, session);
      const { json } = await chatJson({ system: p.system, user: p.user, maxTokens: 500, timeoutMs: 45000 });
      summary = { headline: json.headline || base.summary, focus: Array.isArray(json.focus) ? json.focus.slice(0, 3) : [], reasoning: json.reasoning || '', source: `qwen · ${textModel()}` };
      step('summary', `通义千问 · 5秒摘要（${textModel()}）`, 'done');
      emit({ type: 'partial', key: 'summary', value: summary });
    } catch (e) {
      step('summary', '通义千问 · 5秒摘要', 'fallback', String(e.message).slice(0, 100));
    }
    ensureAlive();

    // 共情话术（流式）
    step('script', `通义千问 · 共情话术生成（${textModel()}）`, 'running');
    try {
      const p = scriptMessages({ ...base, emotion }, session, base.reply);
      let streamed = '';
      const full = await chatStream({
        system: p.system,
        user: p.user,
        maxTokens: 700,
        timeoutMs: 60000,
        onDelta: (delta, soFar) => {
          if (isAborted()) return;
          streamed = soFar;
          emit({ type: 'reply_delta', text: soFar });
        },
      });
      let text = (streamed || full).trim();
      let notes = base.risk.compliance;
      let tone = '';
      const jsonMatch = text.match(/\{[\s\S]*\}$/);
      if (text.startsWith('{') && jsonMatch) {
        try {
          const j = JSON.parse(jsonMatch[0]);
          if (j.reply) {
            text = j.reply;
            tone = j.tone || '';
            if (Array.isArray(j.notes) && j.notes.length) notes = j.notes;
            emit({ type: 'reply_delta', text });
          }
        } catch { /* 流式内容可能不是 JSON，直接用文本 */ }
      }
      reply = { text, tone, notes, source: `qwen · ${textModel()}` };
      step('script', `通义千问 · 共情话术生成（${textModel()}）`, 'done', STAGE_LABELS[base.stage]);
      emit({ type: 'partial', key: 'reply', value: reply });
    } catch (e) {
      step('script', '通义千问 · 共情话术生成', 'fallback', `调用失败，已回退模板：${String(e.message).slice(0, 80)}`);
    }
  } else {
    step('llm_emotion', '通义千问 · 情绪复评', llm ? 'skipped' : 'rules', llm ? '规则模式' : '未配置 DASHSCOPE_API_KEY');
    step('summary', '通义千问 · 5秒摘要', llm ? 'skipped' : 'rules', llm ? '规则模式' : '规则摘要 + 融合要点');
    step('script', '通义千问 · 共情话术生成', llm ? 'skipped' : 'rules', llm ? '规则模式' : `规则话术模板 · ${STAGE_LABELS[base.stage]}`);
  }

  if (base.evaluation.tryMode) {
    step('eval', '对账 · 试跑会话无标注', 'skipped', base.evaluation.summary);
  } else {
    step('eval', '对账 · 对齐真实处理口径', 'done', base.evaluation.summary);
  }
  ensureAlive();

  const analysis = {
    ...base,
    emotion,
    summary,
    reply,
    evidence,
    engine: useLLM ? 'agent' : 'rules',
    llm: useLLM,
    llmModels: llm ? { text: textModel(), vl: vlModel() } : null,
    elapsedMs: Date.now() - started,
  };
  emit({ type: 'done', analysis });
  return analysis;
}
