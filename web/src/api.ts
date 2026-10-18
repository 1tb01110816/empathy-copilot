import type { Insights, Overview, SessionBrief, SessionDetail, StreamEvent, ActionRecord, ChatMessage } from './types';

export const AUTH_EXPIRED_EVENT = 'ec:auth-expired';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    // 会话过期/口令轮换：通知上层回到登录页；登录接口自身的 401 交由表单提示
    if (r.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    throw new Error(`${r.status} ${await r.text().catch(() => '')}`.slice(0, 160));
  }
  return r.json() as Promise<T>;
}

export const getOverview = () => j<Overview>('/api/overview');
export const getSessions = () => j<{ sessions: SessionBrief[]; total: number }>('/api/sessions');
export const getSession = (id: string) => j<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
export const getInsights = () => j<Insights>('/api/insights');

export const getAuthSession = () => j<{ enabled: boolean; authenticated: boolean }>('/api/auth/session');
export const login = (code: string) =>
  j<{ ok: boolean; enabled: boolean }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
export const logout = () => j<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });

export const postAction = (id: string, type: string, payload?: Record<string, unknown>) =>
  j<{ record: ActionRecord; message: ChatMessage }>(`/api/sessions/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });

// 人工发送回复：后端持久化 + 买家侧自动出演下一条回应（只演不做）
export const postSend = (id: string, text: string) =>
  j<{ ok: boolean; resolved: boolean; ended?: boolean; source: string }>(`/api/sessions/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

// 试跑：现场输入买家问题（文本 + 可选图片 + 可选关联订单/工单 + 可选买家画像）创建临时会话
export const postTry = (
  text: string,
  imageDataUrl?: string | null,
  demo = false,
  opts: { orderId?: string | null; ticketId?: string | null; buyerType?: string } = {},
) =>
  j<{ id: string }>('/api/try', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      imageDataUrl: imageDataUrl || null,
      demo,
      orderId: opts.orderId || null,
      ticketId: opts.ticketId || null,
      buyerType: opts.buyerType || 'default',
    }),
  });

// 试跑「可选关联」：从赛题 MOCK 库搜索订单 / 工单
export const searchOrders = (q: string) =>
  j<{ items: Array<{ id: string; name: string; amount: number; status: string; buyer: string; courier: string; tracking: string }> }>(
    `/api/refs/orders?q=${encodeURIComponent(q)}`,
  );
export const searchTickets = (q: string) =>
  j<{ items: Array<{ id: string; kind: string; kindLabel: string; orderId: string; buyer: string; status: string; reason: string }> }>(
    `/api/refs/tickets?q=${encodeURIComponent(q)}`,
  );

// 试跑记录删除：仅影响 TRY 前缀会话与其运行时记录，不触碰赛题数据与对账口径
export const deleteTry = (id: string) => j<{ ok: boolean; id: string }>(`/api/try/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const clearTry = () => j<{ ok: boolean; deleted: number }>('/api/try', { method: 'DELETE' });

// 一键重置演示状态：仅清空真实演示会话的运行时动作/回执与人工发送对话层
export const resetSession = (id: string) =>
  j<{ ok: boolean; id: string }>(`/api/sessions/${encodeURIComponent(id)}/reset`, { method: 'POST' });

export interface StreamHandle {
  close: () => void;
}

// SSE：Agent 工作流事件流；收到 done 或错误后自动断开，避免 EventSource 自动重连
export function streamSession(
  id: string,
  opts: { upto?: number; mode?: 'rules' | 'agent'; onEvent: (e: StreamEvent) => void; onClose?: () => void },
): StreamHandle {
  const params = new URLSearchParams();
  if (opts.upto && Number.isFinite(opts.upto)) params.set('upto', String(opts.upto));
  params.set('mode', opts.mode || 'rules');
  const es = new EventSource(`/api/sessions/${encodeURIComponent(id)}/stream?${params.toString()}`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
    opts.onClose?.();
  };
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data) as StreamEvent;
      opts.onEvent(evt);
      if (evt.type === 'done') close();
    } catch {
      /* 忽略非 JSON 数据 */
    }
  };
  es.onerror = () => {
    close();
    // EventSource 读不到 401，回查会话：失效则通知上层回登录页，网络抖动则忽略
    getAuthSession()
      .then((s) => {
        if (!s.authenticated) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      })
      .catch(() => {});
  };
  return { close };
}
