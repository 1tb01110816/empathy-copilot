import { useEffect, useRef, useState } from 'react';
import { postTry, searchOrders, searchTickets } from '../api';

const EXAMPLE = '刚收到货，泵头按不出来，是不是坏了？\n等了三天才到，这次太失望了，你们打算怎么处理？';

const BUYER_OPTIONS = [
  { key: 'default', label: '默认' },
  { key: 'urgent', label: '急躁型' },
  { key: 'hesitant', label: '犹豫型' },
  { key: 'rational', label: '理性型' },
];

type OrderRef = { id: string; name: string; amount: number; status: string; buyer: string; courier: string; tracking: string };
type TicketRef = { id: string; kind: string; kindLabel: string; orderId: string; buyer: string; status: string; reason: string };

export default function TryModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [demo, setDemo] = useState(true);
  const [buyerType, setBuyerType] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // —— 可选关联订单 / 工单 ——
  const [refOpen, setRefOpen] = useState(false);
  const [refTab, setRefTab] = useState<'order' | 'ticket'>('order');
  const [orderQ, setOrderQ] = useState('');
  const [ticketQ, setTicketQ] = useState('');
  const [orderResults, setOrderResults] = useState<OrderRef[] | null>(null);
  const [ticketResults, setTicketResults] = useState<TicketRef[] | null>(null);
  const [selOrder, setSelOrder] = useState<OrderRef | null>(null);
  const [selTicket, setSelTicket] = useState<TicketRef | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!refOpen || refTab !== 'order' || selOrder) return;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchOrders(orderQ);
        setOrderResults(r.items);
      } catch {
        setOrderResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [orderQ, refOpen, refTab, selOrder]);

  useEffect(() => {
    if (!refOpen || refTab !== 'ticket' || selTicket) return;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchTickets(ticketQ);
        setTicketResults(r.items);
      } catch {
        setTicketResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [ticketQ, refOpen, refTab, selTicket]);

  const pickImage = (file: File) => {
    setError('');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('图片处理失败，请换一张');
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setImage(canvas.toDataURL('image/jpeg', 0.85));
      setImageName(file.name);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('图片读取失败，请换一张');
    };
    img.src = url;
  };

  const submit = async () => {
    if (busy) return;
    if (!text.trim() && !image) {
      setError('请至少输入买家消息或上传一张图片');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { id } = await postTry(text.trim(), image, demo, {
        orderId: selOrder?.id || null,
        ticketId: selTicket?.id || null,
        buyerType,
      });
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="animate-card-in max-h-[92vh] w-[560px] max-w-full overflow-y-auto rounded-xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-slate-800">试跑新问题</span>
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">现场输入</span>
          <button onClick={onClose} className="ml-auto rounded px-2 py-0.5 text-[12px] text-slate-400 hover:bg-slate-100">
            关闭
          </button>
        </div>
        <div className="mt-1 text-[11px] leading-5 text-slate-500">
          粘贴买家消息（一行一条，模拟多轮对话），可选上传一张买家图片，也可从 MOCK 库关联订单 / 工单、选择买家画像。将走同一套共情引擎与
          Agent 工作流（意图 / 情绪 / 风险 / 话术 / 动作）；因无赛题标注数据，对账卡自动跳过，动作执行与消费者端同步照常可用。
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={`例如：\n${EXAMPLE}`}
          className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] leading-5 outline-none focus:border-sky-300 focus:bg-white"
        />

        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickImage(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
          >
            上传买家图片（可选）
          </button>
          {image && (
            <span className="flex items-center gap-1.5">
              <img src={image} alt="预览" className="h-9 w-9 rounded border border-slate-200 object-cover" />
              <span className="max-w-[160px] truncate text-[10px] text-slate-400">{imageName}</span>
              <button
                onClick={() => {
                  setImage(null);
                  setImageName('');
                }}
                className="text-[10px] text-rose-400 hover:text-rose-600"
              >
                移除
              </button>
            </span>
          )}
        </div>

        {/* —— 买家画像（可选） —— */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">买家画像</span>
          {BUYER_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setBuyerType(o.key)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                buyerType === o.key
                  ? 'bg-violet-600 text-white'
                  : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* —— 可选关联订单 / 工单（可折叠） —— */}
        <button
          onClick={() => setRefOpen((v) => !v)}
          className="mt-2.5 flex w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-[11px] text-slate-600 transition hover:bg-slate-100"
        >
          <span className={`text-[10px] text-slate-400 transition-transform ${refOpen ? 'rotate-90' : ''}`}>▶</span>
          关联订单 / 工单（可选）
          {selOrder && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">已选订单 {selOrder.id}</span>}
          {selTicket && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">已选工单 {selTicket.id}</span>}
          <span className="ml-auto text-[10px] text-slate-400">选中后融合卡补齐订单×工单、风险联动</span>
        </button>

        {refOpen && (
          <div className="mt-2 rounded-lg border border-slate-200 p-2.5">
            <div className="flex items-center gap-1.5">
              {(['order', 'ticket'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setRefTab(t)}
                  className={`rounded-md px-2 py-1 text-[11px] transition ${
                    refTab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {t === 'order' ? '订单' : '工单'}
                </button>
              ))}
              {refTab === 'order' ? (
                <input
                  value={orderQ}
                  onChange={(e) => setOrderQ(e.target.value)}
                  placeholder="搜订单号 / 商品名 / 买家 / 物流单号…"
                  className="ml-1 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-sky-300"
                />
              ) : (
                <input
                  value={ticketQ}
                  onChange={(e) => setTicketQ(e.target.value)}
                  placeholder="搜工单号 / 订单号 / 症状 / 原因…"
                  className="ml-1 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-sky-300"
                />
              )}
            </div>

            <div className="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
              {searching && <div className="py-2 text-center text-[11px] text-slate-400">搜索中…</div>}
              {!searching && refTab === 'order' && !selOrder && (orderResults ?? []).length === 0 && (
                <div className="py-2 text-center text-[11px] text-slate-400">输入关键词搜索赛题订单库，或留空浏览</div>
              )}
              {!searching && refTab === 'order' &&
                (orderResults ?? []).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelOrder(o);
                      setOrderResults(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-100 bg-white px-2 py-1.5 text-left transition hover:border-sky-300 hover:bg-sky-50/50"
                  >
                    <span className="font-mono text-[10px] text-slate-400">{o.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                      {o.name}
                      <span className="text-slate-400"> · ¥{o.amount} · {o.status}</span>
                    </span>
                  </button>
                ))}
              {!searching && refTab === 'ticket' && !selTicket && (ticketResults ?? []).length === 0 && (
                <div className="py-2 text-center text-[11px] text-slate-400">输入关键词搜索赛题工单库，或留空浏览</div>
              )}
              {!searching && refTab === 'ticket' &&
                (ticketResults ?? []).map((tk) => (
                  <button
                    key={tk.id}
                    onClick={() => {
                      setSelTicket(tk);
                      setTicketResults(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-100 bg-white px-2 py-1.5 text-left transition hover:border-amber-300 hover:bg-amber-50/50"
                  >
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">{tk.kindLabel}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                      {tk.reason || tk.id}
                      <span className="text-slate-400"> · {tk.status}</span>
                    </span>
                  </button>
                ))}
            </div>

            {selOrder && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-sky-50 px-2 py-1.5 text-[11px] text-sky-700">
                <span className="font-mono">{selOrder.id}</span>
                <span className="min-w-0 flex-1 truncate">{selOrder.name} · ¥{selOrder.amount} · {selOrder.status}</span>
                <button onClick={() => setSelOrder(null)} className="text-[10px] text-sky-400 hover:text-sky-600">
                  移除
                </button>
              </div>
            )}
            {selTicket && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                <span className="font-mono">{selTicket.id}</span>
                <span className="min-w-0 flex-1 truncate">{selTicket.kindLabel} · {selTicket.reason || selTicket.status}</span>
                <button onClick={() => setSelTicket(null)} className="text-[10px] text-amber-400 hover:text-amber-600">
                  移除
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-600">{error}</div>}

        <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-lg border border-violet-100 bg-violet-50/60 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-1 accent-violet-600" />
          <span>
            <span className="font-medium text-violet-700">演示模式</span>
            ：自动出演多轮对话直到问题解决（客服共情回复 → 买家回应 → 客服跟进 → 买家安心收尾），出演按所选画像风格演绎。仅追加演示对话，
            <span className="text-violet-700">不执行任何工单 / 发券等动作</span>。
          </span>
        </label>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] text-slate-400">试跑会话保存在内存中，不参与 138 条数据的统计与对账</span>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50">
              取消
            </button>
            <button
              onClick={submit}
              disabled={busy || (!text.trim() && !image)}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-[12px] text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {busy ? '创建中…' : '开始试跑'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
