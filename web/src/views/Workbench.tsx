import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis, SessionBrief, SessionDetail, TraceStep } from '../types';
import { getSession, postAction, postSend, streamSession, type StreamHandle } from '../api';
import { EXECUTABLE } from '../ui';
import SessionList from '../components/SessionList';
import ChatPanel from '../components/ChatPanel';
import CopilotPanel from '../components/CopilotPanel';

export default function Workbench({
  sessions,
  selectedId,
  onSelect,
  llmAvailable,
  onTry,
  onDeleteTry,
  onClearTry,
}: {
  sessions: SessionBrief[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  llmAvailable: boolean;
  onTry: () => void;
  onDeleteTry: (id: string) => void;
  onClearTry: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [streaming, setStreaming] = useState('');
  const [running, setRunning] = useState<null | 'rules' | 'agent'>(null);
  const [uptoSeq, setUptoSeq] = useState(1);
  const [sending, setSending] = useState(false);
  const [adopted, setAdopted] = useState('');
  const [adoptKey, setAdoptKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((t: string) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const runStream = useCallback(
    (id: string, mode: 'rules' | 'agent', upto?: number) => {
      streamRef.current?.close();
      setRunning(mode);
      setTrace([]);
      setStreaming('');
      streamRef.current = streamSession(id, {
        upto,
        mode,
        onEvent: (e) => {
          if (e.type === 'step') {
            setTrace((prev) => {
              const item: TraceStep = { id: e.id, label: e.label, status: e.status, detail: e.detail, ms: e.ms };
              const i = prev.findIndex((x) => x.id === e.id);
              if (i >= 0) {
                const c = [...prev];
                c[i] = item;
                return c;
              }
              return [...prev, item];
            });
          } else if (e.type === 'partial') {
            setAnalysis((a) => (a ? { ...a, [e.key]: e.value } : a));
          } else if (e.type === 'reply_delta') {
            setStreaming(e.text);
          } else if (e.type === 'done') {
            setAnalysis(e.analysis);
            setStreaming('');
            setRunning(null);
          } else if (e.type === 'error') {
            setRunning(null);
            showToast(`Agent 工作流错误：${e.message}`);
          }
        },
        onClose: () => setRunning((r) => (r ? null : r)),
      });
    },
    [showToast],
  );

  // 选中会话 → 载入详情 + 规则剖析
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setStreaming('');
    setAdopted('');
    getSession(selectedId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setAnalysis(d.analysis);
        setUptoSeq(d.stats.msgs);
        runStream(d.id, 'rules', d.stats.msgs);
      })
      .catch((e) => showToast(`会话加载失败：${e.message}`));
    return () => {
      alive = false;
      streamRef.current?.close();
    };
  }, [selectedId, runStream, showToast]);

  const changeUpto = (v: number) => {
    setUptoSeq(v);
    if (detail) runStream(detail.id, 'rules', v);
  };

  const execute = async (code: string) => {
    if (!detail) return;
    const exec = EXECUTABLE[code];
    if (!exec) return;
    setBusyAction(code);
    try {
      const res = await postAction(detail.id, exec.type, exec.payload);
      setDetail((d) =>
        d
          ? {
              ...d,
              runtime: { ...d.runtime, actions: [...d.runtime.actions, res.record] },
              messages: [...d.messages, res.message],
            }
          : d,
      );
      showToast(`已执行：${res.record.label} · 单号 ${res.record.id}（消费者端已同步进度）`);
    } catch (e) {
      showToast(`执行失败：${(e as Error).message}`);
    } finally {
      setBusyAction(null);
    }
  };

  // 人工发送：后端持久化 + 买家侧自动出演下一条回应；成功后刷新详情并重跑副驾分析
  const send = async (text: string): Promise<boolean> => {
    if (!detail || sending) return false;
    setSending(true);
    try {
      const res = await postSend(detail.id, text);
      const d = await getSession(detail.id);
      setDetail(d);
      setAnalysis(d.analysis);
      setUptoSeq(d.stats.msgs);
      runStream(d.id, 'rules', d.stats.msgs);
      showToast(
        res.ended
          ? '已发送 · 会话已闭环收尾，买家无需继续回复'
          : res.resolved
            ? '已发送 · 买家回应：确认解决'
            : '已发送 · 买家回应：等待后续',
      );
      return true;
    } catch (e) {
      showToast(`发送失败：${(e as Error).message}`);
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-[272px_minmax(0,1fr)_404px]">
      <aside className="min-h-0 border-r border-slate-200 bg-white">
        <SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} onTry={onTry} onDeleteTry={onDeleteTry} onClearTry={onClearTry} />
      </aside>
      <main className="min-h-0">
        {detail && analysis ? (
          <ChatPanel
            detail={detail}
            uptoSeq={uptoSeq}
            onUptoChange={changeUpto}
            lastBuyerSeq={analysis.lastBuyer?.seq}
            adopted={adopted}
            adoptKey={adoptKey}
            onSend={send}
            sending={sending}
          />
        ) : (
          <EmptyState sessions={sessions} onSelect={onSelect} />
        )}
      </main>
      <aside className="min-h-0 border-l border-slate-200 bg-white">
        {detail && analysis ? (
          <CopilotPanel
            detail={detail}
            analysis={analysis}
            trace={trace}
            streaming={streaming}
            running={running}
            llmAvailable={llmAvailable}
            onRun={(mode) => runStream(detail.id, mode, uptoSeq)}
            onExecute={execute}
            onAdopt={(text) => {
              setAdopted(text);
              setAdoptKey((k) => k + 1);
              showToast('话术已填入回复框，可直接编辑发送');
            }}
            busyAction={busyAction}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-slate-400">
            选择左侧会话后，副驾面板将展示
            <br />
            多源融合 → 意图情绪 → 风险动作 → 对账 的完整链路
          </div>
        )}
      </aside>

      {toast && (
        <div className="animate-card-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900/92 px-4 py-2 text-[12px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyState({ sessions, onSelect }: { sessions: SessionBrief[]; onSelect: (id: string) => void }) {
  const demo = sessions.filter((s) => s.demo);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#f3f5f9] p-8">
      <div className="text-[15px] font-semibold text-slate-700">共情副驾 · 客服工作台演示</div>
      <div className="max-w-md text-center text-[12px] leading-5 text-slate-500">
        左侧选择任意会话进入接待视图：中间回放真实聊天记录，右侧副驾同步输出多源融合画像、情绪曲线、风险动作与验收对账。建议从以下三条演示线开始：
      </div>
      <div className="grid w-full max-w-xl gap-2">
        {demo.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-800">{s.demo?.title}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{s.demo?.tag}</span>
              <span className="ml-auto font-mono text-[10px] text-slate-400">{s.id}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{s.demo?.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
