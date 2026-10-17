// 阿里云百炼 DashScope OpenAI 兼容客户端（零依赖 fetch 实现）
// 文本 qwen-plus / 多模态 qwen-vl-max，均支持无 Key 降级
import { recordLlmCall } from './telemetry.js';

const BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export function llmAvailable() {
  return !!process.env.DASHSCOPE_API_KEY;
}
export const textModel = () => process.env.QWEN_TEXT_MODEL || 'qwen-plus';
export const vlModel = () => process.env.QWEN_VL_MODEL || 'qwen-vl-max';

async function request(body, { timeoutMs = 60000, stream = false } = {}) {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('NO_API_KEY');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`DashScope ${res.status}: ${detail.slice(0, 240)}`);
    }
    return stream ? res : res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonLoose(text) {
  if (!text) throw new Error('empty output');
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch { /* 继续宽松解析 */ }
  const start = Math.min(...[t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0));
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (Number.isFinite(start) && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error(`JSON parse failed: ${t.slice(0, 120)}`);
}

export async function chatJson({ system, user, model = textModel(), temperature = 0.3, maxTokens = 1200, timeoutMs = 60000, kind = 'text' }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const base = { model, messages, temperature, max_tokens: maxTokens };
  const started = Date.now();
  let usage = null;
  let ok = false;
  try {
    let data;
    try {
      data = await request({ ...base, response_format: { type: 'json_object' } }, { timeoutMs });
    } catch (e) {
      if (String(e.message).includes('NO_API_KEY')) throw e;
      data = await request(base, { timeoutMs });
    }
    usage = data.usage || null;
    const content = data.choices?.[0]?.message?.content || '';
    const json = parseJsonLoose(content);
    ok = true;
    return { json, usage, meta: { model, kind, ms: Date.now() - started } };
  } finally {
    recordLlmCall({ kind, model, ms: Date.now() - started, usage, ok });
  }
}

export async function chatStream({ system, user, model = textModel(), temperature = 0.6, maxTokens = 800, timeoutMs = 90000, onDelta, kind = 'text' }) {
  const started = Date.now();
  let usage = null;
  let ok = false;
  try {
    const res = await request(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      { timeoutMs, stream: true },
    );
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          if (j.usage) usage = j.usage;
          const delta = j.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onDelta?.(delta, full);
          }
        } catch { /* 忽略半包 */ }
      }
    }
    ok = true;
    return { text: full, usage, meta: { model, kind, ms: Date.now() - started } };
  } finally {
    recordLlmCall({ kind, model, ms: Date.now() - started, usage, ok });
  }
}

export async function visionJson({ prompt, imageDataUrl, model = vlModel(), timeoutMs = 60000, kind = 'vision' }) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        { type: 'text', text: prompt },
      ],
    },
  ];
  const started = Date.now();
  let usage = null;
  let ok = false;
  try {
    let data;
    try {
      data = await request({ model, messages, temperature: 0.2, max_tokens: 600, response_format: { type: 'json_object' } }, { timeoutMs });
    } catch (e) {
      if (String(e.message).includes('NO_API_KEY')) throw e;
      data = await request({ model, messages, temperature: 0.2, max_tokens: 600 }, { timeoutMs });
    }
    usage = data.usage || null;
    const content = data.choices?.[0]?.message?.content || '';
    const json = parseJsonLoose(content);
    ok = true;
    return { json, usage, meta: { model, kind, ms: Date.now() - started } };
  } finally {
    recordLlmCall({ kind, model, ms: Date.now() - started, usage, ok });
  }
}
