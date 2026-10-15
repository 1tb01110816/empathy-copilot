import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, SessionDetail } from '../types';

interface Props {
  detail: SessionDetail;
  uptoSeq: number;
  onUptoChange: (seq: number) => void;
  lastBuyerSeq?: number;
  adopted: string;
  adoptKey: number;
  onSend: (text: string) => Promise<boolean>;
  sending: boolean;
}

export default function ChatPanel({ detail, uptoSeq, onUptoChange, lastBuyerSeq, adopted, adoptKey, onSend, sending }: Props) {
  const [slider, setSlider] = useState(uptoSeq);
  const [draft, setDraft] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setSlider(uptoSeq), [uptoSeq, detail.id]);
  useEffect(() => {
    if (adopted) setDraft(adopted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptKey]);

  const maxSeq = detail.stats.msgs;
  const messages = useMemo(
    () => detail.messages.filter((m) => m.runtime || m.extra || m.seq <= slider),
    [detail.messages, slider],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, detail.id]);

  const commit = (v: number) => {
    setSlider(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onUptoChange(v), 320);
  };

  const order = detail.order as Record<string, unknown> | null;
  const orderName = order ? String(order['商品名称'] || order['商品'] || '订单商品') : '';

  return (
    <div className="flex h-full flex-col bg-[#f3f5f9]">
      {/* 顶部：买家 + 订单卡片（千牛样式） */}
      <div className="border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-slate-800">{detail.buyer}</span>
          <span className="text-[11px] text-slate-400">{detail.id}</span>
          {detail.demo && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">演示线 · {detail.demo.tag}</span>}
          <span className="ml-auto text-[11px] text-slate-400">{detail.startTime} ~ {detail.endTime}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 overflow-x-auto">
          {order && (
            <span className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
              <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700">订单</span>
              <span className="text-slate-600">{orderName}</span>
              <span className="text-slate-400">¥{order['实付金额(元)'] != null ? Number(order['实付金额(元)']).toFixed(0) : '-'}</span>
              <span className="text-slate-400">{String(order['订单状态'] || '')}</span>
            </span>
          )}
          {detail.tickets.map((t) => (
            <span key={String(t.id)} className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
              {t.kindLabel}
              {[t['退货原因'], t['售后原因'], t['问题类型'], t['症状描述']].some(Boolean) && (
                <span className="ml-1 text-violet-500">{String(t['退货原因'] || t['售后原因'] || t['问题类型'] || t['症状描述'] || '')}</span>
              )}
            </span>
          ))}
        </div>
        {/* 回放控制 */}
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-slate-400">回放至</span>
          <input
            type="range"
            min={1}
            max={maxSeq}
            value={slider}
            onChange={(e) => commit(Number(e.target.value))}
            className="h-1 flex-1 accent-sky-600"
          />
          <span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-500">
            #{slider}/{maxSeq}
          </span>
          <button
            onClick={() => commit(maxSeq)}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] ${slider >= maxSeq ? 'bg-slate-100 text-slate-400' : 'bg-sky-600 text-white hover:bg-sky-500'}`}
          >
            最新
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((m) => (
          <Message key={`${m.seq}-${m.runtime ? 'r' : ''}`} m={m} highlight={m.seq === lastBuyerSeq} onImage={setLightbox} />
        ))}
      </div>

      {/* 回复编辑区 */}
      <div className="border-t border-slate-200 bg-white p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入回复，或点击右侧副驾话术「采纳并发送」自动填入…"
          rows={3}
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-[12px] leading-5 outline-none focus:border-sky-300 focus:bg-white"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-slate-400">发送后买家侧自动出演回应（不执行任何动作）</span>
          <button
            onClick={async () => {
              const t = draft.trim();
              if (!t || sending) return;
              const ok = await onSend(t);
              if (ok) setDraft('');
            }}
            disabled={!draft.trim() || sending}
            className="ml-auto rounded-lg bg-slate-900 px-4 py-1.5 text-[12px] text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            {sending ? '买家回应中…' : '发送'}
          </button>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="证据大图" className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <div className="absolute bottom-6 text-[12px] text-white/70">点击任意处关闭 · MOCK 虚构图片</div>
        </div>
      )}
    </div>
  );
}

function Message({ m, highlight, onImage }: { m: ChatMessage; highlight?: boolean; onImage: (u: string) => void }) {
  if (m.isSystem || m.runtime) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[86%] rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[11px] leading-5 text-emerald-800 shadow-sm">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] text-emerald-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            服务进度推送 · 共情副驾
            <span className="ml-1 text-emerald-300">{m.time}</span>
          </div>
          {m.text}
        </div>
      </div>
    );
  }
  const buyer = m.isBuyer;
  return (
    <div className={`flex ${buyer ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[76%]">
        <div className={`mb-0.5 flex items-center gap-1 text-[10px] text-slate-400 ${buyer ? '' : 'justify-end'}`}>
          <span>{m.sender || (buyer ? '买家' : '客服')}</span>
          <span>{m.time}</span>
          {m.simulated && <span className="rounded bg-violet-100 px-1 text-violet-600">演示模拟</span>}
          {highlight && <span className="rounded bg-rose-100 px-1 text-rose-600">最新诉求</span>}
        </div>
        <div
          className={`rounded-2xl px-3 py-2 text-[12px] leading-5 shadow-sm ${
            buyer
              ? `rounded-tl-sm border bg-white text-slate-700 ${highlight ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`
              : 'rounded-tr-sm bg-sky-600 text-white'
          }`}
        >
          {m.contentType === '图片' && m.imageUrl ? (
            <button onClick={() => onImage(m.imageUrl as string)} className="block">
              <img src={m.imageUrl} alt="买家图片" loading="lazy" className="max-h-52 rounded-lg border border-black/5 object-cover" />
              <span className={`mt-1 block text-[10px] ${buyer ? 'text-slate-400' : 'text-sky-100'}`}>
                点击查看大图{m.imagePath ? ' · MOCK 图片' : ''}
              </span>
            </button>
          ) : (
            <span className="whitespace-pre-wrap">{m.text}</span>
          )}
        </div>
        {buyer && m.sceneMinor && (
          <div className="mt-0.5 text-[10px] text-slate-400">
            <span className="rounded bg-slate-100 px-1 py-px">{m.sceneMajor}/{m.sceneMinor}</span>
            {m.ticketId && <span className="ml-1 rounded bg-violet-50 px-1 py-px text-violet-500">工单 {m.ticketId}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
