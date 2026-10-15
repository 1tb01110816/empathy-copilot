import type { RiskLevel } from './types';

export const RISK_META: Record<RiskLevel, { label: string; dot: string; chip: string; solid: string; bar: string }> = {
  red: {
    label: '高风险',
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    solid: 'bg-rose-500 text-white',
    bar: 'bg-rose-500',
  },
  yellow: {
    label: '中风险',
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    solid: 'bg-amber-500 text-white',
    bar: 'bg-amber-500',
  },
  green: {
    label: '常规',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    solid: 'bg-emerald-500 text-white',
    bar: 'bg-emerald-500',
  },
};

export const STEP_META: Record<string, { label: string; cls: string }> = {
  running: { label: '进行中', cls: 'text-sky-600 bg-sky-50 border-sky-200' },
  done: { label: '完成', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  fallback: { label: '降级', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  skipped: { label: '跳过', cls: 'text-slate-500 bg-slate-50 border-slate-200' },
  rules: { label: '规则', cls: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
};

export const KIND_LABEL: Record<string, string> = {
  guide: '指导',
  ticket: '工单',
  followup: '回访',
  refund: '资金',
  coupon: '补偿',
  script: '话术',
  internal: '内部',
};

// 风险动作 code → 可执行动作类型（动作执行层）
export const EXECUTABLE: Record<string, { type: string; payload?: Record<string, unknown> }> = {
  register_adverse: { type: 'register_adverse' },
  reship_create: { type: 'create_reship' },
  reship_urgent: { type: 'create_reship', payload: { urgent: true } },
  exchange_or_reship: { type: 'create_reship' },
  risk_check: { type: 'risk_check' },
  coupon_50: { type: 'issue_coupon', payload: { amount: 50 } },
  coupon_custom: { type: 'issue_coupon' },
  offline_pay: { type: 'offline_pay' },
  return_unsuitable: { type: 'refund' },
  refund_audit: { type: 'refund' },
  escalate: { type: 'escalate' },
  callback_24h: { type: 'escalate' },
};

export const fmtPct = (v: number | undefined) => (v == null ? '-' : `${Math.round(v * 100)}%`);

export const ACTION_ICON: Record<string, string> = {
  register_adverse: 'BL',
  create_reship: 'BH',
  risk_check: 'KOC',
  issue_coupon: 'HV',
  offline_pay: 'PAY',
  refund: 'TK',
  escalate: 'ZS',
};
