import type { SessionBrief } from '../types';

const HIGHLIGHTS: Record<string, string[]> = {
  S00010: ['健康优先：停用 → 登记 → 24h 回访 → 就医指引', '情绪曲线从峰值回落，话术「接情绪」', '执行动作后切消费者端看进度回执'],
  S00003: ['保价被拒：规则边界 + 补偿券挽回', '说明「无权限破规则」，避免过度承诺', '查看话术阶段：开场共情 → 跟进推进'],
  S00024: ['空包裹风控：先核实、不做前置赔付', '证据图审阅（qwen-vl-max）与合规提示', '转风控动作 + 消费者端回执'],
  S00018: ['多模态：实拍色号 vs 订单色号', '补发换货动作与运费承担口径', '可切「规则剖析」对比无 Key 表现'],
};

const FLOW = [
  '在顶部「演示控制」选择引擎（Agent / 规则），选一条演示线会自动重跑',
  '看四张卡：多源融合 → 意图情绪 → 风险动作 → 对账',
  '在工作流 trace 观察 11 步链路与合规过滤结果',
  '点动作清单里的「执行」，到消费者端看进度回执（只演不做）',
  '点「采纳并发送」，买家自动出演一条回应，直到闭环',
  '到数据洞察页看留出集 92.9% 严格一致率与不一致清单',
];

export default function WalkthroughModal({
  sessions,
  onClose,
  onOpen,
  onOpenConsumer,
}: {
  sessions: SessionBrief[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onOpenConsumer: () => void;
}) {
  const demo = sessions.filter((s) => s.demo);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="animate-card-in max-h-[92vh] w-[680px] max-w-full overflow-y-auto rounded-xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-slate-800">演示走查脚本</span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600">约 5 分钟</span>
          <button onClick={onClose} className="ml-auto rounded px-2 py-0.5 text-[12px] text-slate-400 hover:bg-slate-100">
            关闭
          </button>
        </div>
        <div className="mt-1 text-[11px] leading-5 text-slate-500">
          面向评委的标准走查路径。全部数据为赛题 MOCK 虚构数据；演示与发送流程只演不做，所有动作需人工点击执行。
        </div>

        <ol className="mt-3 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
          {FLOW.map((step, i) => (
            <li key={step} className="flex gap-2 text-[11px] leading-5 text-slate-600">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-medium text-slate-400">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-3 space-y-2">
          {demo.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-800">{s.demo?.title}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{s.demo?.tag}</span>
                <span className="font-mono text-[10px] text-slate-400">{s.id}</span>
                <button
                  onClick={() => onOpen(s.id)}
                  className="ml-auto rounded-md bg-slate-900 px-2.5 py-1 text-[11px] text-white transition hover:bg-slate-700"
                >
                  打开会话
                </button>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{s.demo?.desc}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(HIGHLIGHTS[s.id] || []).map((h) => (
                  <span key={h} className="rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-2.5 text-[10px] leading-4 text-slate-500">
          <span>执行动作后：</span>
          <button onClick={onOpenConsumer} className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">
            切到消费者端看回执
          </button>
          <span className="ml-auto">「重跑」可随时重新演示；「重置演示状态」只清运行时层，不影响赛题 138 条数据。</span>
        </div>
      </div>
    </div>
  );
}
