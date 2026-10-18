import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RiskAlert, RiskAlertStatus, RiskBoard, RiskSignalKey } from '../types';
import { getRiskBoard, patchRiskAlert } from '../api';
import { RISK_META } from '../ui';

const STATUS_META: Record<RiskAlertStatus, { label: string; cls: string; active: string; dot: string }> = {
  pending: {
    label: '待处理',
    cls: 'border-rose-200 bg-rose-50 text-rose-600',
    active: 'border-rose-500 bg-rose-500 text-white',
    dot: 'bg-rose-500',
  },
  following: {
    label: '跟进中',
    cls: 'border-sky-200 bg-sky-50 text-sky-600',
    active: 'border-sky-500 bg-sky-500 text-white',
    dot: 'bg-sky-500',
  },
  closed: {
    label: '已闭环',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    active: 'border-emerald-500 bg-emerald-500 text-white',
    dot: 'bg-emerald-500',
  },
};

const SEVERITY_META: Record<RiskAlert['severity'], { label: string; chip: string; border: string }> = {
  urgent: { label: '紧急', chip: 'bg-rose-500 text-white', border: 'border-l-rose-500' },
  high: { label: '较高', chip: 'bg-amber-500 text-white', border: 'border-l-amber-400' },
  medium: { label: '关注', chip: 'bg-slate-400 text-white', border: 'border-l-slate-300' },
};

const TONE_CLS: Record<string, string> = {
  rose: 'border-rose-200 bg-rose-50 text-rose-600',
  sky: 'border-sky-200 bg-sky-50 text-sky-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-600',
};

const SIGNAL_COUNT_KEY: Record<RiskSignalKey, 'complaints' | 'repeatVisits' | 'emotions' | 'repeatRefunds'> = {
  complaint: 'complaints',
  repeatVisit: 'repeatVisits',
  emotion: 'emotions',
  repeatRefund: 'repeatRefunds',
};

type Patch = { status?: RiskAlertStatus; owner?: string; note?: string };

export default function RiskBoardView({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<RiskBoard | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | RiskAlertStatus>('all');
  const [signalFilter, setSignalFilter] = useState<'all' | RiskSignalKey>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const board = await getRiskBoard();
      setData(board);
      setErr('');
    } catch (e) {
      setErr(`加载风险看板失败：${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchAlert = useCallback(async (id: string, patch: Patch) => {
    const res = await patchRiskAlert(id, patch);
    setData((prev) => {
      if (!prev) return prev;
      const alerts = prev.alerts.map((a) => (a.id === id ? { ...a, ...res.state } : a));
      const byStatus: Record<RiskAlertStatus, number> = { pending: 0, following: 0, closed: 0 };
      for (const a of alerts) byStatus[a.status] += 1;
      return { ...prev, alerts, stats: { ...prev.stats, byStatus } };
    });
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.alerts.filter(
      (a) =>
        (statusFilter === 'all' || a.status === statusFilter) &&
        (signalFilter === 'all' || a.signals.some((s) => s.key === signalFilter)),
    );
  }, [data, statusFilter, signalFilter]);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-slate-400">
        {err || '正在聚合 138 个会话的跨会话风险信号…'}
      </div>
    );
  }

  const stats = data.stats;
  const kpis: Array<{ label: string; value: number | string; sub: string; cls: string }> = [
    { label: '预警会话', value: `${stats.total} / ${stats.sessions}`, sub: '一会话一条 · 多信号合并', cls: 'text-slate-800' },
    { label: '待处理', value: stats.byStatus.pending, sub: '等待首次响应', cls: 'text-rose-500' },
    { label: '跟进中', value: stats.byStatus.following, sub: '已指派处理中', cls: 'text-sky-600' },
    { label: '已闭环', value: stats.byStatus.closed, sub: '风险确认关闭', cls: 'text-emerald-600' },
    { label: '紧急预警', value: stats.urgent, sub: '高风险或舆情升级', cls: 'text-rose-600' },
  ];
  const statusTabs: Array<{ key: 'all' | RiskAlertStatus; label: string; count: number }> = [
    { key: 'all', label: '全部', count: stats.total },
    { key: 'pending', label: '待处理', count: stats.byStatus.pending },
    { key: 'following', label: '跟进中', count: stats.byStatus.following },
    { key: 'closed', label: '已闭环', count: stats.byStatus.closed },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#f3f5f9]">
      <div className="mx-auto max-w-[1180px] space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-800">跨会话风险预警</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              自动聚合 138 条赛题会话中的舆情投诉、重复进线、情绪升级、重复退款信号；点击会话可回到工作台处理
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-500">
              只读原始数据 · 状态独立存储
            </span>
            <span className="text-[10px] text-slate-400">更新于 {new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-60"
            >
              {refreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {err && <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{err}</div>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] text-slate-400">{k.label}</div>
              <div className={`mt-1 text-[22px] font-semibold leading-none tabular-nums ${k.cls}`}>{k.value}</div>
              <div className="mt-1 text-[9px] text-slate-400">{k.sub}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {statusTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                  statusFilter === t.key ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className="ml-1 text-[9px] tabular-nums text-slate-400">{t.count}</span>
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <FilterChip active={signalFilter === 'all'} onClick={() => setSignalFilter('all')}>
            全部信号 {stats.total}
          </FilterChip>
          {data.signals.map((s) => (
            <FilterChip
              key={s.key}
              active={signalFilter === s.key}
              onClick={() => setSignalFilter((cur) => (cur === s.key ? 'all' : s.key))}
              title={s.desc}
            >
              {s.label} {stats[SIGNAL_COUNT_KEY[s.key]]}
            </FilterChip>
          ))}
          <span className="ml-auto text-[10px] text-slate-400">{filtered.length} 条结果</span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-[12px] text-slate-400">
            当前筛选下没有预警。调整状态或信号筛选，可查看全部 {stats.total} 条。
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                expanded={expandedId === alert.id}
                onToggle={() => setExpandedId((cur) => (cur === alert.id ? null : alert.id))}
                onPatch={patchAlert}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}

        <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-3 text-[10px] leading-4 text-slate-400">
          判定口径：舆情投诉 = 买家明确出现投诉/举报/平台介入/12315 等表述（排除「就不投诉了」等否定式）；
          重复进线 = 同一买家累计接待 ≥3 次；情绪升级 = 会话情绪峰值 ≥55；重复退款 = 同一买家退款类工单（线下打款/售后退货）≥2 张。
          信号由现有引擎确定性计算，不修改赛题 138 条原始数据；状态、负责人与备注独立存储在风险跟踪表中。
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-full border px-2.5 py-0.5 text-[10px] transition ${
        active ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function AlertCard({
  alert,
  expanded,
  onToggle,
  onPatch,
  onOpen,
}: {
  alert: RiskAlert;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (id: string, patch: Patch) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const severity = SEVERITY_META[alert.severity];
  const status = STATUS_META[alert.status];
  const [owner, setOwner] = useState(alert.owner);
  const [note, setNote] = useState(alert.note);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    setOwner(alert.owner);
    setNote(alert.note);
  }, [alert.owner, alert.note, alert.id]);

  const save = async (patch: Patch) => {
    setSaving(true);
    setFlash('');
    try {
      await onPatch(alert.id, patch);
      setFlash('已保存');
    } catch (e) {
      setFlash(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const preview = alert.signals[0]?.evidence[0]?.text || alert.signals[0]?.detail || '';

  return (
    <div
      data-testid={`risk-alert-${alert.sessionId}`}
      className={`rounded-xl border border-l-4 border-slate-200 bg-white ${severity.border}`}
    >
      <div className="flex items-start gap-3 p-3">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${severity.chip}`}>{severity.label}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpen(alert.sessionId)}
              aria-label={`打开会话 ${alert.sessionId}`}
              className="font-mono text-[11px] text-sky-600 hover:underline"
            >
              {alert.sessionId}
            </button>
            <span className="text-[12px] font-medium text-slate-700">{alert.buyer}</span>
            <span className={`rounded-full border px-1.5 py-px text-[9px] ${RISK_META[alert.riskLevel].chip}`}>
              {RISK_META[alert.riskLevel].label}
            </span>
            <span className="text-[10px] text-slate-400">{alert.sceneKey}</span>
            <span
              data-testid={`risk-status-${alert.sessionId}`}
              className={`ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${status.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {alert.signals.map((s) => (
              <span
                key={s.key}
                title={s.desc}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${TONE_CLS[s.tone] || TONE_CLS.rose}`}
              >
                {s.label}
              </span>
            ))}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
            <span>情绪峰值 <b className="font-medium text-slate-500">{alert.peak}</b></span>
            <span>到店 {alert.visits} 次</span>
            <span>历史工单 {alert.priorTickets} 张</span>
            <span>退款工单 {alert.refundTickets} 张</span>
            {alert.owner && <span>负责人 {alert.owner}</span>}
            {alert.updatedAt && <span>更新 {alert.updatedAt}</span>}
          </div>

          {!expanded && preview && (
            <div className="mt-1.5 truncate rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
              <span className="text-slate-400">{alert.signals[0].label}：</span>
              {preview}
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[10px] text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
        >
          {expanded ? '收起' : '展开处理'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div>
              <div className="text-[10px] font-medium text-slate-400">信号依据</div>
              <div className="mt-1 space-y-1.5">
                {alert.signals.map((s) => (
                  <div key={s.key} className="rounded-lg border border-slate-100 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-1.5 py-px text-[9px] ${TONE_CLS[s.tone] || TONE_CLS.rose}`}>
                        {s.label}
                      </span>
                      <span className="text-[10px] text-slate-500">{s.detail}</span>
                    </div>
                    {s.evidence.length > 0 ? (
                      s.evidence.map((e, i) => (
                        <div key={i} className="mt-1 text-[10px] leading-4 text-slate-500">
                          {e.time && <span className="mr-1 font-mono text-slate-300">{e.time}</span>}
                          「{e.text}」
                        </div>
                      ))
                    ) : (
                      <div className="mt-1 text-[10px] text-slate-400">{s.desc}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-medium text-slate-400">建议动作</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {alert.suggestedActions.map((a) => (
                    <span
                      key={a.code}
                      className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600"
                    >
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-medium text-slate-400">处理状态</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(Object.keys(STATUS_META) as RiskAlertStatus[]).map((s) => (
                    <button
                      key={s}
                      aria-label={`将 ${alert.sessionId} 标记为${STATUS_META[s].label}`}
                      disabled={saving || alert.status === s}
                      onClick={() => void save({ status: s })}
                      className={`rounded-full border px-2.5 py-1 text-[10px] transition disabled:cursor-default ${
                        alert.status === s ? STATUS_META[s].active : `${STATUS_META[s].cls} hover:opacity-80`
                      }`}
                    >
                      {STATUS_META[s].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-medium text-slate-400">跟进记录</div>
                <div className="mt-1 grid gap-1.5 md:grid-cols-[150px_1fr_auto]">
                  <input
                    aria-label={`${alert.sessionId} 负责人`}
                    value={owner}
                    maxLength={24}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="负责人（可选）"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 outline-none focus:border-sky-300"
                  />
                  <input
                    aria-label={`${alert.sessionId} 跟进备注`}
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="跟进备注（可选，最多 200 字）"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 outline-none focus:border-sky-300"
                  />
                  <button
                    onClick={() => void save({ owner: owner.trim(), note: note.trim() })}
                    disabled={saving}
                    className="rounded-md bg-slate-800 px-2.5 py-1 text-[10px] text-white transition hover:bg-slate-700 disabled:opacity-60"
                  >
                    保存记录
                  </button>
                </div>
                {flash && (
                  <div className={`mt-1 text-[9px] ${flash.startsWith('保存失败') ? 'text-rose-500' : 'text-emerald-600'}`}>{flash}</div>
                )}
              </div>

              <button
                onClick={() => onOpen(alert.sessionId)}
                className="text-[10px] text-sky-600 hover:underline"
              >
                打开 {alert.sessionId} 工作台处理 →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
