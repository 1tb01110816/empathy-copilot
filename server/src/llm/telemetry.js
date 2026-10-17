// LLM 调用可观测性：进程内累计 token / 耗时 / 模型，供 trace 与 /api/llm/usage 查看
const totals = {
  calls: 0,
  ok: 0,
  failed: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  totalMs: 0,
  byKind: {},
  byModel: {},
};

function bump(bucket, key, call) {
  if (!bucket[key]) bucket[key] = { calls: 0, failed: 0, totalTokens: 0, totalMs: 0 };
  const b = bucket[key];
  b.calls += 1;
  if (!call.ok) b.failed += 1;
  b.totalTokens += call.totalTokens;
  b.totalMs += call.ms;
}

export function recordLlmCall({ kind = 'text', model = '', ms = 0, usage = null, ok = true } = {}) {
  const call = {
    kind,
    model,
    ms: Math.max(0, Math.round(ms)),
    ok,
    promptTokens: Number(usage?.prompt_tokens || 0),
    completionTokens: Number(usage?.completion_tokens || 0),
    totalTokens: Number(usage?.total_tokens || 0),
  };
  totals.calls += 1;
  totals.ok += ok ? 1 : 0;
  totals.failed += ok ? 0 : 1;
  totals.totalMs += call.ms;
  totals.promptTokens += call.promptTokens;
  totals.completionTokens += call.completionTokens;
  totals.totalTokens += call.totalTokens;
  bump(totals.byKind, kind, call);
  if (model) bump(totals.byModel, model, call);
  return call;
}

export function llmUsage() {
  return JSON.parse(JSON.stringify(totals));
}

export function resetLlmUsage() {
  Object.assign(totals, {
    calls: 0, ok: 0, failed: 0,
    promptTokens: 0, completionTokens: 0, totalTokens: 0, totalMs: 0,
    byKind: {}, byModel: {},
  });
}
