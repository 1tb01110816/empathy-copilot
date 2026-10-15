import { useEffect, useMemo, useState } from 'react';
import type { Insights, InsightSession } from '../types';
import { getInsights } from '../api';
import { RISK_META, fmtPct } from '../ui';
import EChart from '../components/EChart';

const AGREEMENT_LABEL: Record<string, string> = {
  scene: '场景（细分）',
  sceneMajor: '场景（大类归并）',
  level: '风险等级',
  actions: '应对动作',
  overall: '综合一致率',
};

export default function InsightsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState('');
  const [onlyDemo, setOnlyDemo] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(false);

  useEffect(() => {
    getInsights()
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.perSession.filter((p) => (!onlyDemo || p.demo) && (!onlyMismatch || !p.evalPass));
  }, [data, onlyDemo, onlyMismatch]);

  const riskOption = useMemo(() => {
    if (!data) return null;
    return {
      tooltip: { trigger: 'item' as const },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'pie' as const,
          radius: ['52%', '74%'],
          center: ['50%', '42%'],
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          data: [
            { name: '高风险', value: data.riskCount.red, itemStyle: { color: '#f43f5e' } },
            { name: '中风险', value: data.riskCount.yellow, itemStyle: { color: '#f59e0b' } },
            { name: '常规', value: data.riskCount.green, itemStyle: { color: '#10b981' } },
          ],
        },
      ],
    };
  }, [data]);

  const sceneOption = useMemo(() => {
    if (!data) return null;
    const list = [...data.sceneDistribution].reverse();
    return {
      grid: { left: 8, right: 30, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
      xAxis: { type: 'value' as const, splitLine: { lineStyle: { color: '#eef2f7' } }, axisLabel: { fontSize: 10 } },
      yAxis: {
        type: 'category' as const,
        data: list.map((d) => d.key.replace('/', ' · ')),
        axisLabel: { fontSize: 10, width: 130, overflow: 'truncate' as const },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar' as const,
          data: list.map((d) => d.count),
          barWidth: 10,
          itemStyle: { color: '#0ea5e9', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right' as const, fontSize: 10, color: '#64748b' },
        },
      ],
    };
  }, [data]);

  if (err) {
    return <div className="flex h-full items-center justify-center text-[12px] text-rose-500">加载洞察失败：{err}</div>;
  }
  if (!data) {
    return <div className="flex h-full items-center justify-center text-[12px] text-slate-400">正在对 138 个会话批量运行引擎…</div>;
  }

  const s = data.stats;
  const kpis: Array<[string, number | string]> = [
    ['会话总数', s.sessions],
    ['消息总量', s.messages],
    ['买家消息 / 图片', `${s.buyerMessages} / ${s.images}`],
    ['买家数（含复购）', s.buyers],
    ['关联订单会话', `${s.sessionsWithOrder} / ${s.sessions}`],
    ['关联工单会话', `${s.sessionsWithTicket} / ${s.sessions}`],
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#f3f5f9]">
      <div className="mx-auto max-w-[1180px] space-y-4 p-5">
        {/* KPI 行 */}
        <div className="grid grid-cols-6 gap-3">
          {kpis.map(([label, v]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] text-slate-400">{label}</div>
              <div className="mt-1 text-[18px] font-semibold tabular-nums text-slate-800">{v}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* 一致率 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-slate-800">引擎 × 数据标注 一致率</div>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">
                {data.mismatches.length === 0 ? '全量对齐 ✓' : `${data.mismatches.length} 条不一致`}
              </span>
            </div>
            <div className="mt-3 space-y-2.5">
              {Object.entries(AGREEMENT_LABEL).map(([k, label]) => {
                const v = data.agreement[k] ?? 0;
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{label}</span>
                      <span className={`font-medium tabular-nums ${v >= 1 ? 'text-emerald-600' : v >= 0.9 ? 'text-amber-600' : 'text-rose-500'}`}>
                        {fmtPct(v)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${v >= 1 ? 'bg-emerald-500' : v >= 0.9 ? 'bg-amber-500' : 'bg-rose-500'}`}
                        style={{ width: `${Math.round(v * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] leading-4 text-slate-500">
              口径：场景分类、红黄绿分级、应对动作三项逐一比对数据表标注（结果表 OUTCOME / 工单表 / 会话场景列），综合一致 = 三项全部命中。
              少数场景按业务等价组归并（如「物流异常/包裹破损」与「补发换货/破损换货」视为同一处理口径）。
            </div>
          </div>

          {/* 风险分布 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[13px] font-semibold text-slate-800">风险分布（引擎判定）</div>
            <div className="mt-2">{riskOption && <EChart option={riskOption} height={190} />}</div>
          </div>

          {/* 风险会话速览 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[13px] font-semibold text-slate-800">
              高风险会话速览 <span className="ml-1 text-[10px] font-normal text-rose-500">{data.riskSessions.red.length} 条</span>
            </div>
            <div className="mt-2 max-h-[190px] space-y-1.5 overflow-y-auto pr-1">
              {data.riskSessions.red.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="group flex w-full items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-left hover:border-rose-200 hover:bg-rose-50/50"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RISK_META[p.level].dot}`} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600 group-hover:text-slate-800">{p.sceneKey}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">{p.id}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-rose-500">峰值 {Math.round(p.peak)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 场景分布 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[13px] font-semibold text-slate-800">高频场景分布（数据标注口径 · 消息数）</div>
            <div className="mt-2">{sceneOption && <EChart option={sceneOption} height={260} />}</div>
          </div>

          <div className="space-y-4">
            {/* 情绪峰值 TOP */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[13px] font-semibold text-slate-800">情绪峰值 TOP8</div>
              <div className="mt-2 space-y-1">
                {data.topUpset.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => onOpen(p.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-50"
                  >
                    <span className="w-4 text-[10px] tabular-nums text-slate-300">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{p.sceneKey}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">{p.id}</span>
                    <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-amber-600">{Math.round(p.peak)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 工单热点 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[13px] font-semibold text-slate-800">工单热点（类型 × 原因）</div>
              <div className="mt-2 space-y-1">
                {data.ticketHotspots.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{t.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{t.reason}</span>
                    <span className="tabular-nums text-slate-400">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 全量会话对账表 */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="text-[13px] font-semibold text-slate-800">全量会话对账</div>
            <span className="text-[10px] text-slate-400">
              {rows.length} / {data.perSession.length} 条
            </span>
            <div className="ml-auto flex gap-2">
              <FilterChip active={onlyDemo} onClick={() => setOnlyDemo((v) => !v)}>仅演示线</FilterChip>
              <FilterChip active={onlyMismatch} onClick={() => setOnlyMismatch((v) => !v)}>
                仅不一致（{data.mismatches.length}）
              </FilterChip>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">会话</th>
                  <th className="px-2 py-2 font-medium">买家</th>
                  <th className="px-2 py-2 font-medium">引擎场景</th>
                  <th className="px-2 py-2 font-medium">标注场景</th>
                  <th className="px-2 py-2 text-center font-medium">等级 引擎/标注</th>
                  <th className="px-2 py-2 text-right font-medium">峰值</th>
                  <th className="px-2 py-2 text-center font-medium">场景</th>
                  <th className="px-2 py-2 text-center font-medium">等级</th>
                  <th className="px-2 py-2 text-center font-medium">动作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Row key={p.id} p={p} onOpen={onOpen} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[10px] transition ${
        active ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function Row({ p, onOpen }: { p: InsightSession; onOpen: (id: string) => void }) {
  const ok = (b: boolean) => (b ? 'text-emerald-500' : 'text-rose-500');
  return (
    <tr
      onClick={() => onOpen(p.id)}
      className="cursor-pointer border-t border-slate-50 hover:bg-sky-50/40"
    >
      <td className="px-4 py-1.5">
        <span className="font-mono text-[10px] text-slate-500">{p.id}</span>
        {p.demo && <span className="ml-1.5 rounded bg-indigo-50 px-1 py-px text-[9px] text-indigo-500">演示</span>}
      </td>
      <td className="px-2 py-1.5 text-slate-600">{p.buyer}</td>
      <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700" title={p.sceneKey}>{p.sceneKey}</td>
      <td className="max-w-[150px] truncate px-2 py-1.5 text-slate-400" title={p.gtScene}>{p.gtScene}</td>
      <td className="px-2 py-1.5 text-center">
        <span className={`inline-block h-2 w-2 rounded-full ${RISK_META[p.level].dot}`} title={`引擎：${RISK_META[p.level].label}`} />
        <span className="mx-1 text-slate-300">/</span>
        <span className={`inline-block h-2 w-2 rounded-full ${RISK_META[p.gtLevel].dot}`} title={`标注：${RISK_META[p.gtLevel].label}`} />
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{Math.round(p.peak)}</td>
      <td className={`px-2 py-1.5 text-center ${ok(p.sceneOk)}`}>{p.sceneOk ? '✓' : '✕'}</td>
      <td className={`px-2 py-1.5 text-center ${ok(p.levelOk)}`}>{p.levelOk ? '✓' : '✕'}</td>
      <td className={`px-2 py-1.5 text-center ${ok(p.actionOk)}`}>
        {p.actionOk ? '✓' : <span title={p.missing.join('、')}>✕</span>}
      </td>
    </tr>
  );
}
