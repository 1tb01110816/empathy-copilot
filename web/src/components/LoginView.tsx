import { useState } from 'react';
import { login } from '../api';

export default function LoginView({ initialNotice, onSuccess }: { initialNotice?: string; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialNotice || '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await login(code.trim());
      onSuccess();
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if (msg.startsWith('401')) setError('口令不正确，请重试');
      else if (msg.startsWith('429')) setError('尝试次数过多，请稍后再试');
      else if (msg.startsWith('400')) setError('请输入访问口令');
      else setError('无法连接服务，请确认后端已启动');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 text-[16px] text-white shadow-sm">
              共
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-slate-800">共情副驾 Empathy Copilot</div>
              <div className="mt-0.5 text-[10px] text-slate-400">千牛客服工作台右侧辅助插件 · 演示环境</div>
            </div>
          </div>

          <p className="mt-5 text-[12px] leading-relaxed text-slate-500">
            请输入演示访问口令。口令由组织者提供，登录后 7 天内免重复输入。
          </p>

          <form onSubmit={submit} className="mt-4">
            <label htmlFor="access-code" className="text-[11px] font-medium text-slate-600">
              访问口令
            </label>
            <div className="mt-1.5 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 transition focus-within:border-sky-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100">
              <input
                id="access-code"
                type={show ? 'text' : 'password'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="请输入口令"
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-300"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="ml-2 shrink-0 text-[10px] text-slate-400 transition hover:text-slate-600"
                tabIndex={-1}
              >
                {show ? '隐藏' : '显示'}
              </button>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="mt-4 h-10 w-full rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-[13px] font-medium text-white shadow-sm transition hover:from-sky-600 hover:to-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '正在验证…' : '进入工作台'}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-3 text-[10px] leading-relaxed text-slate-400">
            邀请链接可直接免输入进入（<span className="font-mono">/enter?code=…</span>）。如口令失效，请向组织者获取最新链接。
          </div>
        </div>

        <div className="mt-4 text-center text-[10px] text-slate-400">
          全部数据为赛题 MOCK 虚构数据，仅供演示
        </div>
      </div>
    </div>
  );
}
