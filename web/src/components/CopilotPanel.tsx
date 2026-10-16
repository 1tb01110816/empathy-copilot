import { useState, type ReactNode } from 'react';
import type { Analysis, SessionDetail, TraceStep } from '../types';
import { EXECUTABLE, KIND_LABEL, RISK_META, STEP_META } from '../ui';
import EmotionChart from './EmotionChart';

interface Props {
  detail: SessionDetail;
  analysis: Analysis;
  trace: TraceStep[];
  streaming: string;
  running: null | 'rules' | 'agent';
  llmAvailable: boolean;
  onRun: (mode: 'rules' | 'agent') => void;
  onExecute: (code: string) => void;
  onAdopt: (text: string) => void;
  busyAction: string | null;
}

const STAGE_META: Record<string, { label: string; cls: string }> = {
  opening: { label: '开场共情', cls: 'border-sky-200 bg-sky-50 text-sky-600' },
  followup: { label: '跟进推进', cls: 'border-amber-200 bg-amber-50 text-amber-600' },
  closing: { label: '收尾安抚', cls: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
};

export default function CopilotPanel(p: Props) {
  const { detail, analysis, trace, streaming, running } = p;
  const risk = analysis.risk;
  const meta = RISK_META[risk.level];
  const stageMeta = analysis.stage ? STAGE_META[analysis.stage] : null;
  const replyText = streaming || (typeof analysis.reply === 'string' ? analysis.reply : analysis.reply?.text || '');
  const replySource = typeof analysis.reply === 'object' ? analysis.reply?.source : '规则模板';
  const replyNotes = typeof analysis.reply === 'object' ? analysis.reply?.notes || [] : risk.compliance;
  const summary = typeof analysis.summary === 'string'
    ? { headline: analysis.summary, focus: risk.reasons.slice(0, 3), source: 'rules' }
    : analysis.summary;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(replyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略剪贴板权限失败 */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div className="text-[13px] font-semibold text-slate-700">共情副驾</div>
        <span className={`rounded border px-1.5 py-px text-[10px] ${analysis.llm ? 'border-violet-200 bg-violet-50 text-violet-600' : 'border-sky-200 bg-sky-50 text-sky-600'}`}>
          {analysis.llm ? `通义千问 · ${analysis.llmModels?.text || 'qwen'}` : '标准模式'}
        </span>
        {analysis.elapsedMs != null && <span className="text-[10px] text-slate-400">{(analysis.elapsedMs / 1000).toFixed(1)}s</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => p.onRun('rules')}
            disabled={!!running}
            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            规则剖析
          </button>
          <button
            onClick={() => p.onRun('agent')}
            disabled={!!running}
            className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {running === 'agent' ? 'Agent 运行中…' : 'Agent 工作流'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* 1. 多源融合感知 */}
        <Card index="01" title="多源融合感知" sub="聊天 × 订单 × 工单 × 买家历史">
          <div className="mb-2 flex flex-wrap gap-1">
            {analysis.fusion.sources.map((s) => (
              <span
                key={s.key}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${s.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                title={s.detail}
              >
                {s.label} {s.ok ? '已接入' : '无数据'}
              </span>
            ))}
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
            <div>
              <span className="font-medium text-slate-700">{analysis.fusion.buyer.visits > 1 ? '老客户' : '新客户'}</span>
              <span className="text-slate-400">
                {' '}· 历史接待 {analysis.fusion.buyer.visits - 1} 次 · 累计订单 {analysis.fusion.buyer.totalOrders} 笔 / ¥{Math.round(analysis.fusion.buyer.totalSpend)} · 历史工单 {analysis.fusion.buyer.priorTickets.length} 张
              </span>
            </div>
            {analysis.fusion.order && (
              <div>
                订单 <span className="text-slate-700">{analysis.fusion.order.name || analysis.fusion.order.id}</span>
                {analysis.fusion.order.amount != null && <span> · ¥{Number(analysis.fusion.order.amount).toFixed(0)}</span>}
                {analysis.fusion.order.status && <span> · {analysis.fusion.order.status}</span>}
                {analysis.fusion.order.tracking && <span> · {analysis.fusion.order.courier} {analysis.fusion.order.tracking}</span>}
              </div>
            )}
            {analysis.fusion.tickets.length > 0 && (
              <div>
                关联工单：
                {analysis.fusion.tickets.map((t) => (
                  <span key={t.id} className="mr-1 inline-block rounded bg-violet-50 px-1 text-[10px] text-violet-600">
                    {t.kindLabel} {t.reason ? `· ${t.reason}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
          {analysis.fusion.highlights.length > 0 && (
            <ul className="mt-2 space-y-1">
              {analysis.fusion.highlights.map((h, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-5 text-slate-600">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
                  {h}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 2. 共情分析 */}
        <Card index="02" title="意图 × 情绪 × 摘要" sub={analysis.intent.switched ? '检测到意图切换' : '单场景会话'}>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-white">{analysis.sceneKey}</span>
            {analysis.intent.dominant.slice(1, 3).map((d) => (
              <span key={`${d.major}/${d.minor}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {d.major}/{d.minor} ×{d.count}
              </span>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {analysis.intent.timeline.map((t) => (
              <span
                key={t.seq}
                title={`#${t.seq} ${t.intent || ''}`}
                className={`rounded border px-1 py-px text-[10px] ${
                  t.sceneKey === analysis.sceneKey ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-400'
                }`}
              >
                #{t.seq} {t.minor || '未识别'}
              </span>
            ))}
          </div>
          <EmotionChart curve={analysis.emotion} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`rounded border px-1.5 py-0.5 ${meta.chip}`}>{analysis.emotion?.state}</span>
            <span className="text-slate-500">
              峰值 <b className="text-slate-700">{Math.round(analysis.emotion?.peak?.value ?? 0)}</b>@#{analysis.emotion?.peak?.seq} · 当前{' '}
              <b className="text-slate-700">{Math.round(analysis.emotion?.current?.value ?? 0)}</b>
            </span>
            {analysis.emotion?.turns?.length > 0 && (
              <span className="text-slate-400">
                拐点 {analysis.emotion.turns.map((t) => `${t.dir === 'up' ? '↑' : '↓'}#${t.seq}`).join(' ')}
              </span>
            )}
            {analysis.emotion?.blended && <span className="text-violet-500">已融合通义千问复评</span>}
          </div>

          <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
              5 秒交接摘要 <span className="rounded bg-white px-1 text-[9px] text-slate-400">{typeof summary === 'object' ? summary.source : 'rules'}</span>
            </div>
            <div className="text-[12px] font-medium leading-5 text-slate-700">{summary?.headline}</div>
            {Array.isArray(summary?.focus) && summary.focus.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {summary.focus.map((f: string, i: number) => (
                  <li key={i} className="flex gap-1.5 text-[11px] text-slate-500">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {analysis.evidence && (
            <div className="mt-2 flex gap-2 rounded-lg border border-sky-100 bg-sky-50/50 p-2">
              <img src={analysis.evidence.imageUrl} alt="证据" className="h-16 w-16 shrink-0 rounded-md border border-sky-100 object-cover" />
              <div className="min-w-0 text-[11px] leading-5">
                <div className="flex items-center gap-1">
                  <span className="font-medium text-sky-800">多模态证据理解</span>
                  <span className="rounded bg-white px-1 text-[9px] text-sky-500">{analysis.evidence.source}</span>
                  {analysis.evidence.support && (
                    <span className={`rounded px-1 text-[9px] ${analysis.evidence.support.includes('支持') ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      {analysis.evidence.support}
                    </span>
                  )}
                </div>
                <div className="text-slate-700">{analysis.evidence.verdict}</div>
                {analysis.evidence.findings?.map((f, i) => (
                  <div key={i} className="text-slate-500">· {f}</div>
                ))}
                {analysis.evidence.suggestion && <div className="text-slate-400">建议：{analysis.evidence.suggestion}</div>}
                {analysis.evidence.error && <div className="text-amber-500">{analysis.evidence.error}</div>}
              </div>
            </div>
          )}
        </Card>

        {/* 3. 决策建议 */}
        <Card index="03" title="风险分级 × 动作建议" sub={`引擎判定 ${meta.label}`}>
          <div className={`mb-2 flex items-center gap-2 rounded-lg border p-2 ${meta.chip} ${risk.level === 'red' ? 'animate-risk-red' : ''}`}>
            <span className={`rounded px-2 py-0.5 text-[12px] font-bold ${meta.solid}`}>{risk.level === 'red' ? 'RED' : risk.level === 'yellow' ? 'YELLOW' : 'GREEN'}</span>
            <span className="text-[11px]">{risk.reasons[0]}</span>
          </div>
          {risk.reasons.length > 1 && (
            <ul className="mb-2 space-y-0.5">
              {risk.reasons.slice(1).map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-5 text-slate-500">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  {r}
                </li>
              ))}
            </ul>
          )}
          <div className="mb-2 space-y-1">
            {risk.actions.map((a) => {
              const exec = EXECUTABLE[a.code];
              return (
                <div key={a.code} className="flex items-center gap-2 rounded-md border border-slate-100 bg-white px-2 py-1.5">
                  <span className="rounded bg-slate-100 px-1 py-px text-[9px] text-slate-500">{KIND_LABEL[a.kind] || a.kind}</span>
                  <span className="flex-1 text-[11px] text-slate-700">{a.label}</span>
                  {exec && (
                    <button
                      onClick={() => p.onExecute(a.code)}
                      disabled={p.busyAction === a.code}
                      className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600 transition hover:bg-sky-100 disabled:opacity-40"
                    >
                      {p.busyAction === a.code ? '执行中' : '执行'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="rounded-md bg-slate-50 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
              共情话术
              {stageMeta && <span className={`rounded border px-1 py-px text-[9px] font-normal ${stageMeta.cls}`}>{stageMeta.label}</span>}
              <span>（可编辑后发送）</span>
            </div>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-slate-700">
              {replyText}
              {running === 'agent' && streaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-slate-400 align-middle" />}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="rounded bg-white px-1 text-[9px] text-slate-400">{replySource}</span>
              <div className="ml-auto flex gap-1">
                <button onClick={copy} className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-white">
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  onClick={() => p.onAdopt(replyText)}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500"
                >
                  采纳并发送
                </button>
              </div>
            </div>
            {replyNotes?.length > 0 && (
              <div className="mt-1.5 border-t border-slate-200 pt-1 text-[10px] leading-4 text-slate-400">
                合规提示：{replyNotes.join('；')}
              </div>
            )}
          </div>
        </Card>

        {/* 4. 验收对账 */}
        <Card index="04" title="对账 · 对齐真实处理口径" sub={analysis.evaluation?.summary}>
          {analysis.evaluation?.tryMode ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 text-slate-500">
              试跑会话为现场输入，无赛题数据标注，自动跳过对账。可将上方动作建议与自身业务口径对照使用；动作执行与消费者端同步照常可用。
            </div>
          ) : (
            <div className="space-y-1.5">
              {analysis.evaluation?.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-2 rounded-md border border-slate-100 px-2 py-1.5">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white ${c.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                    {c.ok ? '✓' : '×'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-700">{c.label}</div>
                    <div className="text-[10px] leading-4 text-slate-500">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {analysis.groundTruth?.outcomes?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {analysis.groundTruth.outcomes.map((o) => (
                <span key={o.code} className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" title={o.evidence}>
                  数据真实处理：{o.label}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Agent 工作流 trace */}
        <Card index="05" title="Agent 工作流" sub={running ? '执行中…' : `最近一次 ${trace.length} 步`}>
          <ol className="space-y-1">
            {trace.map((s) => {
              const m = STEP_META[s.status] || STEP_META.rules;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === 'running' ? 'animate-pulse bg-sky-500' : 'bg-slate-300'}`} />
                  <span className="text-[11px] text-slate-600">{s.label}</span>
                  <span className={`rounded border px-1 text-[9px] ${m.cls}`}>{m.label}</span>
                  {s.detail && <span className="min-w-0 flex-1 truncate text-right text-[10px] text-slate-400">{s.detail}</span>}
                  {s.ms != null && <span className="shrink-0 text-[9px] text-slate-300">{s.ms}ms</span>}
                </li>
              );
            })}
            {trace.length === 0 && <li className="text-[11px] text-slate-400">点击「规则剖析」或「Agent 工作流」运行</li>}
          </ol>
        </Card>

        {/* 已执行动作 */}
        <Card index="06" title="动作执行记录" sub={`${detail.runtime.actions.length} 条`}>
          {detail.runtime.actions.length === 0 ? (
            <div className="text-[11px] text-slate-400">暂无已执行动作。在上方动作清单点击「执行」，将生成工单号并同步消费者端进度。</div>
          ) : (
            <div className="space-y-1">
              {detail.runtime.actions.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-[11px]">
                  <span className="rounded bg-emerald-50 px-1 py-px font-mono text-[10px] text-emerald-700">{a.id}</span>
                  <span className="text-slate-700">{a.label}</span>
                  <span className="ml-auto rounded bg-slate-100 px-1 text-[10px] text-slate-500">{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="pb-2 text-center text-[10px] text-slate-300">
          引擎 {analysis.engine === 'agent' ? 'Agent（通义千问）' : '规则'} · 数据为赛题 MOCK 虚构数据 · 对账展示引擎输出与数据标注/真实处理的一致性
        </div>
      </div>
    </div>
  );
}

function Card({ index, title, sub, children }: { index: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="animate-card-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-slate-300">{index}</span>
        <h3 className="text-[12px] font-semibold text-slate-800">{title}</h3>
        {sub && <span className="min-w-0 truncate text-[10px] text-slate-400">{sub}</span>}
      </div>
      {children}
    </section>
  );
}
