import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Overview, SessionBrief } from './types';
import { getOverview, getSessions, deleteTry, clearTry, getAuthSession, logout, AUTH_EXPIRED_EVENT } from './api';
import LoginView from './components/LoginView';

// 按 Tab 懒加载视图，减小首屏 bundle
const Workbench = lazy(() => import('./views/Workbench'));
const ConsumerView = lazy(() => import('./views/ConsumerView'));
const InsightsView = lazy(() => import('./views/InsightsView'));
const TryModal = lazy(() => import('./components/TryModal'));

function ViewFallback() {
  return <div className="flex h-full items-center justify-center text-[12px] text-slate-400">加载中…</div>;
}

type Tab = 'workbench' | 'consumer' | 'insights';

export default function App() {
  const [tab, setTab] = useState<Tab>('workbench');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<SessionBrief[]>([]);
  // 深色模式：localStorage 持久化
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('ec:dark') === '1');
  // 记住上次选中的会话：页面刷新/HMR 重载后不跳回默认会话（试跑会话与演示消息不"消失"）
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem('ec:selectedId') || 'S00010');
  const [bootErr, setBootErr] = useState('');
  const [tryOpen, setTryOpen] = useState(false);
  // 鉴权：null=校验中；false=未登录（显示登录页）；true=已登录（渲染工作台）
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const authedRef = useRef<boolean | null>(null);

  useEffect(() => {
    authedRef.current = authed;
  }, [authed]);

  // 邀请链接失败/缺失口令时由 /enter 重定向回首页并带 ?auth=…，读取后清理地址栏
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('auth');
    if (flag) {
      setAuthNotice(flag === 'failed' ? '口令不正确，请重新输入' : flag === 'required' ? '请输入访问口令' : '');
      window.history.replaceState(null, '', window.location.pathname);
    }
    getAuthSession()
      .then((s) => {
        setAuthEnabled(s.enabled);
        setAuthed(s.authenticated);
      })
      // 鉴权端点异常（后端未启动等）时继续渲染主界面，由原有 bootErr 提示诊断
      .catch(() => setAuthed(true));
  }, []);

  useEffect(() => {
    // 深色 class 挂到 <html>：使 .dark body 等根级规则生效（挂组件 div 时 body 不随动）
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ec:dark', dark ? '1' : '0');
  }, [dark]);

  // 会话过期（Cookie 到期 / 服务端口令轮换）：清空内存态并回到登录页
  const expireSession = useCallback(() => {
    setAuthNotice('登录状态已失效，请重新登录');
    setOverview(null);
    setSessions([]);
    setTryOpen(false);
    setAuthed(false);
  }, []);

  useEffect(() => {
    const onExpire = () => {
      if (authedRef.current !== true) return;
      expireSession();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpire);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpire);
  }, [expireSession]);

  // 标签页重新可见/窗口聚焦时复验会话：长时间挂后台过期后无需手动刷新
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      getAuthSession()
        .then((s) => {
          if (alive && !s.authenticated) expireSession();
        })
        .catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [authed, expireSession]);

  const refreshSessions = useCallback(() => {
    return getSessions()
      .then((ss) => setSessions(ss.sessions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authed) return;
    Promise.all([getOverview(), getSessions()])
      .then(([ov, ss]) => {
        setOverview(ov);
        setSessions(ss.sessions);
        setSelectedId((cur) => (cur && ss.sessions.some((s) => s.id === cur) ? cur : 'S00010'));
        setBootErr('');
      })
      .catch((e) => setBootErr(String(e.message || e)));
  }, [authed]);

  useEffect(() => {
    if (selectedId) localStorage.setItem('ec:selectedId', selectedId);
  }, [selectedId]);

  const openSession = useCallback((id: string) => {
    setSelectedId(id);
    setTab('workbench');
  }, []);

  const onTryCreated = useCallback(
    (id: string) => {
      setTryOpen(false);
      refreshSessions();
      setSelectedId(id);
      setTab('workbench');
    },
    [refreshSessions],
  );

  // 删除单条试跑记录：若删的是当前选中会话，回落到默认演示会话
  const onDeleteTry = useCallback(
    async (id: string) => {
      try {
        await deleteTry(id);
      } catch (e) {
        alert(`删除失败：${(e as Error).message}`);
        return;
      }
      if (id === selectedId) setSelectedId('S00010');
      await refreshSessions();
    },
    [selectedId, refreshSessions],
  );

  // 清空全部试跑记录（确认框在会话列表分组头触发）
  const onClearTry = useCallback(async () => {
    try {
      await clearTry();
    } catch (e) {
      alert(`清空失败：${(e as Error).message}`);
      return;
    }
    if (selectedId?.startsWith('TRY')) setSelectedId('S00010');
    await refreshSessions();
  }, [selectedId, refreshSessions]);

  // 退出登录：清除 Cookie 并回到登录页；接口失败也保持登出观感（旧 Cookie 由服务端校验）
  const onLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* 忽略网络错误 */
    }
    setOverview(null);
    setSessions([]);
    setAuthNotice('');
    setAuthed(false);
  }, []);

  if (authed === null) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 text-[12px] text-slate-400">
        正在验证访问权限…
      </div>
    );
  }

  if (!authed) {
    return (
      <LoginView
        initialNotice={authNotice}
        onSuccess={() => {
          setAuthNotice('');
          setAuthed(true);
        }}
      />
    );
  }

  const llm = overview?.llm;
  const stats = overview?.stats;

  return (
    <div className={`flex h-full flex-col ${dark ? 'dark' : ''}`}>
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 text-[13px] text-white">
            共
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-slate-800">共情副驾 Empathy Copilot</div>
            <div className="text-[10px] text-slate-400">千牛客服工作台右侧辅助插件 · 一引擎双端输出</div>
          </div>
        </div>

        <nav className="ml-6 flex shrink-0 rounded-lg bg-slate-100 p-0.5">
          <TabBtn active={tab === 'workbench'} onClick={() => setTab('workbench')}>
            客服工作台
          </TabBtn>
          <TabBtn active={tab === 'consumer'} onClick={() => setTab('consumer')}>
            消费者端
          </TabBtn>
          <TabBtn active={tab === 'insights'} onClick={() => setTab('insights')}>
            数据洞察
          </TabBtn>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setDark((v) => !v)}
            className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            title="切换深色 / 浅色模式（框架级适配）"
          >
            {dark ? '浅色模式' : '深色模式'}
          </button>
          {authEnabled && (
            <button
              onClick={onLogout}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
              title="退出登录（清除本机会话 Cookie）"
            >
              退出
            </button>
          )}
          {stats && (
            <span className="hidden text-[10px] text-slate-400 lg:block">
              {stats.sessions} 会话 · {stats.messages} 消息 · {stats.tickets} 工单
            </span>
          )}
          {overview?.storage && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] ${
                overview.storage.mode === 'mysql'
                  ? 'border-sky-200 bg-sky-50 text-sky-600'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-600'
              }`}
              title={
                overview.storage.mode === 'mysql'
                  ? `试跑记录持久化到 MySQL（${overview.storage.host} / ${overview.storage.database}）`
                  : `演示数据模式（未接入 MySQL：${overview.storage.reason || '未配置'}）——试跑记录重启后清空`
              }
            >
              存储：{overview.storage.mode === 'mysql' ? `MySQL · ${overview.storage.database}` : '演示数据 · 重启清空'}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
              llm?.available
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                : 'border-sky-200 bg-sky-50 text-sky-600'
            }`}
            title={
              llm?.available
                ? '已配置 DASHSCOPE_API_KEY，Agent 工作流将调用通义千问'
                : '标准模式已就绪；配置 DASHSCOPE_API_KEY 后可启用通义千问 Agent 模式'
            }
          >
            <span className={`h-1.5 w-1.5 rounded-full ${llm?.available ? 'bg-emerald-500' : 'bg-sky-500'}`} />
            {llm?.available ? `通义千问已接入 · ${llm.textModel} / ${llm.vlModel}` : '标准模式 · 已就绪'}
          </span>
        </div>
      </header>

      {bootErr && (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-600">
          后端连接失败：{bootErr} —— 请确认 server 已在 8787 端口启动（npm run dev:server）
        </div>
      )}

      {overview?.storage?.mode === 'memory' && (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-1 text-[10px] text-amber-700">
          演示实例：试跑记录仅保存在内存，服务重启 / 重新部署后清空；赛题 138 条 MOCK 数据为只读，不受影响。
        </div>
      )}

      {/* 主视图 */}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<ViewFallback />}>
          {tab === 'workbench' && (
            <Workbench
              sessions={sessions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              llmAvailable={!!llm?.available}
              onTry={() => setTryOpen(true)}
              onDeleteTry={onDeleteTry}
              onClearTry={onClearTry}
              onOpenConsumer={() => setTab('consumer')}
            />
          )}
          {tab === 'consumer' && <ConsumerView sessionId={selectedId} />}
          {tab === 'insights' && <InsightsView onOpen={openSession} />}
        </Suspense>
      </div>

      {/* 页脚：数据合规声明 */}
      <footer className="shrink-0 border-t border-slate-100 bg-white px-4 py-1 text-center text-[10px] text-slate-300">
        共情副驾 Empathy Copilot · 全部数据为赛题 MOCK 虚构数据，仅供演示
      </footer>

      {tryOpen && (
        <Suspense fallback={null}>
          <TryModal onClose={() => setTryOpen(false)} onCreated={onTryCreated} />
        </Suspense>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-md px-3 py-1 text-[12px] transition ${
        active ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
