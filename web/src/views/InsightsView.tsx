import { useEffect, useMemo, useState } from 'react';
import type { AgreementBreakdown, Insights, InsightSession } from '../types';
import { getInsights } from '../api';
import { RISK_META } from '../ui';
import EChart from '../components/EChart';

const METRICS: Array<{ key: keyof AgreementBreakdown; label: string }> = [
  { key: 'sceneStrict', label: '场景（严格）' },
  { key: 'scene', label: '场景（等价归并）' },
  { key: 'level', label: '风险等级' },
  { key: 'actions', label: '动作覆盖' },
  { key: 'strictOverall', label: '综合（严格）' },
];

const fmtRate = (v: number) => `${Math.round(v * 1000) / 10}%`;
const rateCls = (v: number) => (v >= 0.99 ? 'text-emerald-600' : v >= 0.9 ? 'text-amber-600' : 'text-rose-500');
const fmtSec = (v: number) => (v < 60 ? `${Math.round(v)}s` : `${Math.floor(v / 60)}m${String(Math.round(v % 60)).padStart(2, '0')}s`);

export default function InsightsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState('');
  const [onlyDemo, setOnlyDemo] = useState(false);
  const [onlyHoldout, setOnlyHoldout] = useState(false);
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
    return data.perSession.filter(
      (p) => (!onlyDemo || p.demo) && (!onlyHoldout || p.holdout) && (!onlyMismatch || !p.strictPass),
    );
  }, [data, onlyDemo, onlyHoldout, onlyMismatch]);

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

        {/* 业务价值代理指标 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-semibold text-slate-800">业务价值代理指标</div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
              全量 {data.business.sample} 条 MOCK 对话
            </span>
            <span className="text-[10px] text-slate-400">非真实 CSAT，均为会话时间戳 / 轮次 / 情绪 / 画像的可复算代理口径</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['首响均值', fmtSec(data.business.firstResponse.avgSec), `样本 ${data.business.firstResponse.samples}`],
              ['首响 P90', fmtSec(data.business.firstResponse.p90Sec), `≤${data.business.firstResponse.slaSec}s 达标 ${fmtRate(data.business.firstResponse.slaRate)}`],
              ['平均会话时长', `${data.business.handle.avgMin} 分`, `P90 ${data.business.handle.p90Min} 分`],
              ['买家平均发言', `${data.business.engagement.buyerMsgsAvg} 条`, `图片会话 ${fmtRate(data.business.engagement.imageSessionRate)}`],
              ['老客复访会话占比', fmtRate(data.business.repeatSessionRate), '按买家历史接待次数'],
              ['高风险会话占比', fmtRate(data.business.highRiskRate), `RED ${data.riskCount.red} 条`],
              ['明显情绪缓和率', fmtRate(data.business.emotionRelief.rate), `${data.business.emotionRelief.calm}/${data.business.emotionRelief.total} · 平均回落 ${data.business.emotionRelief.avgDrop} 分`],
              ['买家正向收尾率', fmtRate(data.business.positiveClose.rate), `${data.business.positiveClose.positive}/${data.business.positiveClose.total} · 词典代理`],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                <div className="text-[10px] text-slate-400">{label}</div>
                <div className="mt-1 text-[18px] font-semibold tabular-nums text-slate-800">{value}</div>
                <div className="mt-0.5 text-[9px] leading-3 text-slate-400">{sub}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] leading-4 text-slate-400">
            首响 = 买家首条消息 → 客服首条回复；情绪缓和 = 峰值 ≥45 的会话中末条较峰值下降 ≥10 分的比例；
            正向收尾按「谢谢 / 放心 / 满意 / 解决」等词表判定，仅作演示代理，不等同真实满意度调研。
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* 留出集评估 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-slate-800">留出集评估 × 数据标注</div>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
                留出 {data.split.holdoutCount} / {data.split.total}
              </span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className={`text-[30px] font-semibold leading-none tabular-nums ${rateCls(data.holdoutAgreement.sceneStrict)}`}>
                {fmtRate(data.holdoutAgreement.sceneStrict)}
              </div>
              <div className="pb-0.5 text-[10px] leading-3 text-slate-400">
                留出集严格场景一致率
                <br />
                {Math.round(data.holdoutAgreement.sceneStrict * data.split.holdoutCount)} / {data.split.holdoutCount} 条
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="grid grid-cols-[1fr_48px_48px_48px] gap-1.5 text-[9px] text-slate-400">
                <span>指标</span>
                <span className="text-right">留出</span>
                <span className="text-right">内测</span>
                <span className="text-right">全量</span>
              </div>
              {METRICS.map(({ key, label }) => (
                <div key={key} className="grid grid-cols-[1fr_48px_48px_48px] items-center gap-1.5 text-[11px]">
                  <span className="truncate text-slate-500">{label}</span>
                  <span className={`text-right font-medium tabular-nums ${rateCls(data.holdoutAgreement[key])}`}>
                    {fmtRate(data.holdoutAgreement[key])}
                  </span>
                  <span className={`text-right tabular-nums ${rateCls(data.devAgreement[key])}`}>{fmtRate(data.devAgreement[key])}</span>
                  <span className={`text-right tabular-nums ${rateCls(data.agreement[key])}`}>{fmtRate(data.agreement[key])}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] leading-4 text-slate-500">
              按标注场景大类分层，SHA-256(seed:会话ID) 排序取 30%，确定性可复算；留出集不参与规则调校。
              严格场景 = 与标注细分场景精确匹配、不做等价归并；综合严格 = 严格场景 + 等级 + 动作覆盖。
              规则由赛题数据人工校准，本指标用于校正全量内测的乐观偏差。
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
              <FilterChip active={onlyHoldout} onClick={() => setOnlyHoldout((v) => !v)}>
                仅留出集（{data.split.holdoutCount}）
              </FilterChip>
              <FilterChip active={onlyMismatch} onClick={() => setOnlyMismatch((v) => !v)}>
                仅严格不一致（{data.strictMismatches.length}）
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
                  <th className="px-2 py-2 text-center font-medium" title="细分场景精确匹配，不做等价归并">严格场景</th>
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
        {p.holdout && <span className="ml-1.5 rounded bg-sky-50 px-1 py-px text-[9px] text-sky-600">留出</span>}
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
      <td className={`px-2 py-1.5 text-center ${ok(p.sceneExact)}`} title={p.sceneExact ? '' : `引擎 ${p.sceneKey} ↔ 标注 ${p.gtScene}`}>
        {p.sceneExact ? '✓' : '✕'}
      </td>
      <td className={`px-2 py-1.5 text-center ${ok(p.levelOk)}`}>{p.levelOk ? '✓' : '✕'}</td>
      <td className={`px-2 py-1.5 text-center ${ok(p.actionOk)}`}>
        {p.actionOk ? '✓' : <span title={p.missing.join('、')}>✕</span>}
      </td>
    </tr>
  );
}
