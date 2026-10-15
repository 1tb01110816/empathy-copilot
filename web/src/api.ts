import type { Insights, Overview, SessionBrief, SessionDetail, StreamEvent, ActionRecord, ChatMessage } from './types';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`.slice(0, 160));
  return r.json() as Promise<T>;
}

export const getOverview = () => j<Overview>('/api/overview');
export const getSessions = () => j<{ sessions: SessionBrief[]; total: number }>('/api/sessions');
export const getSession = (id: string) => j<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
export const getInsights = () => j<Insights>('/api/insights');

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

// 试跑：现场输入买家问题（文本 + 可选图片）创建临时会话；demo 时自动出演客服回复与买家反应
export const postTry = (text: string, imageDataUrl?: string | null, demo = false) =>
  j<{ id: string }>('/api/try', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, imageDataUrl: imageDataUrl || null, demo }),
  });

// 试跑记录删除：仅影响 TRY 前缀会话与其运行时记录，不触碰赛题数据与对账口径
export const deleteTry = (id: string) => j<{ ok: boolean; id: string }>(`/api/try/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const clearTry = () => j<{ ok: boolean; deleted: number }>('/api/try', { method: 'DELETE' });

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
  es.onerror = () => close();
  return { close };
}
