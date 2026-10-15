import { useEffect, useState } from 'react';
import type { SessionDetail } from '../types';
import { getSession } from '../api';

// 消费者端视图：买家视角的手机窗口 + 已执行动作的进度回执（双端联动演示）
export default function ConsumerView({ sessionId }: { sessionId: string | null }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    getSession(sessionId)
      .then((d) => {
        setDetail(d);
        setErr('');
      })
      .catch((e) => setErr(String(e.message || e)));
  }, [sessionId, tick]);

  // 轮询刷新，让客服端刚执行的动作尽快出现在消费者端（演示用轻量方案）
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 4000);
    return () => clearInterval(t);
  }, []);

  if (!sessionId || !detail) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-slate-400">
        {err ? `加载失败：${err}` : '先在工作台选择一个会话，这里将同步展示消费者端视角'}
      </div>
    );
  }

  const messages = detail.messages.filter((m) => m.runtime || !m.isSystem);
  const actions = detail.runtime.actions;

  return (
    <div className="flex h-full items-start justify-center gap-6 overflow-y-auto bg-[#eef1f5] p-6">
      {/* 手机窗口 */}
      <div className="w-[380px] shrink-0 overflow-hidden rounded-[28px] border-[10px] border-slate-900 bg-[#f5f6f8] shadow-2xl">
        <div className="flex items-center justify-between bg-slate-900 px-5 py-2 text-[10px] text-slate-300">
          <span>9:41</span>
          <span className="h-1.5 w-16 rounded-full bg-slate-700" />
          <span>100%</span>
        </div>
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-[11px] text-rose-600">测</span>
          <div>
            <div className="text-[12px] font-semibold text-slate-800">{detail.shop} · {detail.buyer}</div>
            <div className="text-[10px] text-emerald-500">客服在线 · 共情副驾已接管本次会话</div>
          </div>
        </div>
        <div className="h-[560px] space-y-3 overflow-y-auto p-3">
          {messages.map((m) => {
            if (m.runtime) {
              return (
                <div key={`${m.seq}-r`} className="flex justify-center">
                  <div className="max-w-[92%] rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-800">
                    <div className="mb-0.5 text-[10px] text-emerald-500">服务进度 · 系统推送</div>
                    {m.text}
                  </div>
                </div>
              );
            }
            const buyer = m.isBuyer;
            return (
              <div key={m.seq} className={`flex ${buyer ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div className={`rounded-2xl px-3 py-2 text-[12px] leading-5 shadow-sm ${buyer ? 'rounded-tr-sm bg-emerald-500 text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700'}`}>
                    {m.contentType === '图片' && m.imageUrl ? (
                      <img src={m.imageUrl} alt="订单凭证" className="max-h-44 rounded-lg" />
                    ) : (
                      <span className="whitespace-pre-wrap">{m.text}</span>
                    )}
                  </div>
                  <div className={`mt-0.5 text-[9px] text-slate-400 ${buyer ? 'text-right' : ''}`}>{m.time}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 进度回执面板 */}
      <div className="w-[340px] shrink-0 space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold text-slate-800">服务进度回执（双端闭环）</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">
            客服在工作台右侧副驾点击「执行」动作后，工单与补偿进度会实时回流到消费者端，避免买家反复追问。
          </div>
          <div className="mt-3 space-y-2">
            {actions.length === 0 && <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-400">暂无动作。去工作台右栏执行「登记不良反应 / 转风控 / 发券 / 补发」试试。</div>}
            {actions.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">{a.id}</span>
                  <span className="text-[12px] font-medium text-slate-700">{a.label}</span>
                  <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{a.status}</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-400">{a.at} · 类型 {a.type}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold text-slate-800">买家情绪保护提示</div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-slate-600">
            <li>· 负面情绪会话自动接入「共情副驾」话术，客服回复先共情再讲规则；</li>
            <li>· 健康类反馈（泛红/刺痒/闷痘）自动生成停用提醒与 24 小时回访承诺；</li>
            <li>· 所有补偿（券/打款/补发）带单号回流，进度可追溯、可对账。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
