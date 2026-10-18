// 风险看板状态跟踪：仅存 status/owner/note，与赛题 MOCK 表、试跑表完全隔离。
// MySQL 不可用时退化为进程内存储；重启清空仅影响看板状态，不影响 138 条数据。
import { dbMode, dbQuery } from './db.js';

export const RISK_STATUSES = ['pending', 'following', 'closed'];
export const RISK_STATUS_LABEL = {
  pending: '待处理',
  following: '跟进中',
  closed: '已闭环',
};

export const defaultRiskState = () => ({ status: 'pending', owner: '', note: '', updatedAt: '' });

const memoryStates = new Map();

const nowStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function normalize(row) {
  return {
    status: RISK_STATUSES.includes(row?.status) ? row.status : 'pending',
    owner: String(row?.owner || ''),
    note: String(row?.note || ''),
    updatedAt: String(row?.updated_at ?? row?.updatedAt ?? ''),
  };
}

export async function loadRiskStates() {
  if (dbMode() === 'mysql') {
    try {
      const [rows] = await dbQuery(
        'SELECT alert_id, status, owner, note, updated_at FROM risk_alert_state',
      );
      const merged = new Map(memoryStates);
      for (const row of rows) merged.set(row.alert_id, normalize(row));
      return merged;
    } catch (e) {
      console.error('[risk-board] 状态读取失败，使用内存状态：', String(e.message || e));
    }
  }
  return new Map(memoryStates);
}

export async function saveRiskState(alertId, patch = {}) {
  const current = (await loadRiskStates()).get(alertId) || defaultRiskState();
  const next = {
    status: RISK_STATUSES.includes(patch.status) ? patch.status : current.status,
    owner: patch.owner !== undefined ? String(patch.owner) : current.owner,
    note: patch.note !== undefined ? String(patch.note) : current.note,
    updatedAt: nowStr(),
  };
  memoryStates.set(alertId, next);
  if (dbMode() === 'mysql') {
    try {
      await dbQuery(
        `INSERT INTO risk_alert_state (alert_id, status, owner, note, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = ?, owner = ?, note = ?, updated_at = ?`,
        [alertId, next.status, next.owner, next.note, next.updatedAt, next.status, next.owner, next.note, next.updatedAt],
      );
    } catch (e) {
      console.error('[risk-board] 状态写入失败，仅保留内存状态：', String(e.message || e));
    }
  }
  return next;
}

// 将持久化状态叠加到只读预警投影上，并重算状态分布
export function applyRiskStates(board, states) {
  const alerts = board.alerts.map((a) => ({ ...a, ...(states.get(a.id) || defaultRiskState()) }));
  const byStatus = { pending: 0, following: 0, closed: 0 };
  for (const a of alerts) byStatus[a.status] += 1;
  return { ...board, alerts, stats: { ...board.stats, byStatus } };
}
