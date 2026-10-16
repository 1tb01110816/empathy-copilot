import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionBrief } from '../types';
import { RISK_META } from '../ui';

type Filter = 'all' | 'demo' | 'red' | 'yellow' | 'green';

const RISK_ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2 };

export default function SessionList({
  sessions,
  selectedId,
  onSelect,
  onTry,
  onDeleteTry,
  onClearTry,
}: {
  sessions: SessionBrief[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTry: () => void;
  onDeleteTry: (id: string) => void;
  onClearTry: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [kw, setKw] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filter === 'demo' && !s.demo) return false;
      if ((filter === 'red' || filter === 'yellow' || filter === 'green') && s.riskLevel !== filter) return false;
      if (kw) {
        const t = kw.trim().toLowerCase();
        if (!s.id.toLowerCase().includes(t) && !s.buyer.toLowerCase().includes(t) && !(s.engineScene || '').includes(kw)) return false;
      }
      return true;
    });
  }, [sessions, filter, kw]);

  const tryList = useMemo(() => filtered.filter((s) => s.tryMode), [filtered]);
  const demoList = useMemo(() => filtered.filter((s) => s.demo && !s.tryMode), [filtered]);
  // 全部会话：按风险等级排序（红 → 黄 → 绿），高优先级置顶
  const rest = useMemo(
    () => filtered.filter((s) => !s.demo && !s.tryMode).sort((a, b) => (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9)),
    [filtered],
  );

  // 键盘导航用的扁平列表（与渲染顺序一致）
  const flatList = useMemo(() => [...tryList, ...demoList, ...rest], [tryList, demoList, rest]);

  useEffect(() => {
    const idx = flatList.findIndex((s) => s.id === selectedId);
    setFocusIdx(idx);
  }, [selectedId, flatList]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const n = flatList.length;
    if (!n) return;
    e.preventDefault();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const cur = focusIdx >= 0 ? focusIdx : -1;
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, n - 1) : Math.max(cur - 1, 0);
      setFocusIdx(next);
      onSelect(flatList[next].id);
      const el = listRef.current?.querySelector(`[data-session-id="${flatList[next].id}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < n) {
      onSelect(flatList[focusIdx].id);
    }
  };

  const chips: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'demo', label: '演示线' },
    { key: 'red', label: '红' },
    { key: 'yellow', label: '黄' },
    { key: 'green', label: '绿' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-slate-700">客户接待 · 会话列表</div>
          <div className="text-[11px] text-slate-400">{filtered.length} 个会话</div>
        </div>
        <button
          onClick={onTry}
          className="mb-2 w-full rounded-lg border border-dashed border-sky-300 bg-sky-50/60 px-2.5 py-1.5 text-[12px] text-sky-700 transition hover:border-sky-400 hover:bg-sky-100"
        >
          ＋ 试跑新问题（现场输入，可选图片）
        </button>
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索 会话ID / 买家 / 场景…"
          className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] outline-none focus:border-sky-300 focus:bg-white"
        />
        <div className="flex gap-1">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                filter === c.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        aria-label="会话列表（可用 ↑ ↓ 方向键切换，Enter 打开）"
      >
        {tryList.length > 0 && (
          <div className="px-3 pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">试跑会话（现场输入 · 不参与对账统计）</span>
              <button
                onClick={() => {
                  if (window.confirm(`确定清空全部 ${tryList.length} 条试跑记录？此操作仅影响试跑数据，不可恢复。`)) onClearTry();
                }}
                className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                title="清空全部试跑记录"
              >
                清空
              </button>
            </div>
            {tryList.map((s) => (
              <Row key={s.id} s={s} active={s.id === selectedId} onSelect={onSelect} onDelete={() => onDeleteTry(s.id)} />
            ))}
          </div>
        )}
        {demoList.length > 0 && (
          <div className="px-3 pt-2">
            <div className="mb-1 text-[11px] font-medium text-slate-400">演示线（赛题数据真实处理结果可对账）</div>
            {demoList.map((s) => (
              <DemoCard key={s.id} s={s} active={s.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        )}
        {rest.length > 0 && (
          <>
            <div className="mb-1 mt-3 px-3 text-[11px] font-medium text-slate-400">全部会话</div>
            {rest.map((s) => (
              <Row key={s.id} s={s} active={s.id === selectedId} onSelect={onSelect} />
            ))}
          </>
        )}
        {filtered.length === 0 && <div className="p-6 text-center text-[12px] text-slate-400">没有匹配的会话</div>}
      </div>
    </div>
  );
}

function DemoCard({ s, active, onSelect }: { s: SessionBrief; active: boolean; onSelect: (id: string) => void }) {
  const meta = RISK_META[s.riskLevel];
  return (
    <button
      data-session-id={s.id}
      onClick={() => onSelect(s.id)}
      className={`mb-1.5 w-full rounded-lg border p-2.5 text-left transition ${
        active ? 'border-sky-300 bg-sky-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${meta.dot} ${s.riskLevel === 'red' && active ? 'animate-risk-red' : ''}`} />
        <span className="text-[12px] font-semibold text-slate-800">{s.demo?.title}</span>
        <span className={`ml-auto rounded border px-1 py-px text-[10px] ${meta.chip}`}>{s.demo?.tag}</span>
      </div>
      <div className="mt-1 text-[11px] leading-4 text-slate-500">{s.demo?.desc}</div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
        <span>{s.id}</span>
        <span>{s.buyer}</span>
        <span>{s.msgs} 条消息</span>
        {s.images > 0 && <span>图 {s.images}</span>}
      </div>
    </button>
  );
}

function Row({
  s,
  active,
  onSelect,
  onDelete,
}: {
  s: SessionBrief;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete?: () => void;
}) {
  const meta = RISK_META[s.riskLevel];
  return (
    <button
      data-session-id={s.id}
      onClick={() => onSelect(s.id)}
      className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left transition ${
        active ? 'bg-sky-50/80' : 'hover:bg-slate-50'
      }`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-slate-700">{s.buyer}</span>
          <span className="text-[10px] text-slate-400">{s.id}</span>
          {s.tryMode && <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-600">试跑</span>}
          {s.ticketKinds.length > 0 && <span className="rounded bg-violet-50 px-1 text-[10px] text-violet-600">工单×{s.ticketKinds.length}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{s.preview}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
          <span className="truncate">{s.engineScene || s.sceneKey}</span>
          <span className="shrink-0">{s.msgs} 条</span>
        </span>
      </span>
      <span className={`mt-1 shrink-0 text-[10px] ${s.riskPeak >= 62 ? 'text-rose-500' : 'text-slate-400'}`}>{Math.round(s.riskPeak)}</span>
      {onDelete && (
        <span
          role="button"
          tabIndex={-1}
          title="删除这条试跑记录"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`确定删除试跑会话 ${s.id}？此操作不可恢复。`)) onDelete();
          }}
          className="mt-0.5 shrink-0 rounded px-1 text-[11px] leading-4 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
        >
          ×
        </span>
      )}
    </button>
  );
}
