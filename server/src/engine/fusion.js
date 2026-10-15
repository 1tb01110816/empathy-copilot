// 多源跨维度融合：聊天 × 订单 × 工单 × 买家历史
import { buyerHistory } from '../store.js';

const KIND_ACTIONS = {
  reship: '补发换货',
  payoff: '线下打款',
  logistics: '物流处理',
  adverse: '不良反应登记',
  return: '售后退货',
};

function ticketSummary(t) {
  if (t.kind === 'adverse') {
    return {
      kind: t.kind, kindLabel: t.kindLabel, id: t['工单号'],
      reason: t['症状描述'], status: t['任务状态'] || t['工单状态'],
      detail: `${t['使用商品']} · 用后${t['用后多久出现']} · ${t['不适部位']} · ${t['是否停用']}`,
      createdAt: t['创建时间'], doneAt: t['完成时间'],
    };
  }
  if (t.kind === 'return') {
    return {
      kind: t.kind, kindLabel: t.kindLabel, id: t['工单号'],
      reason: t['退货原因'], status: t['任务状态'] || t['工单状态'],
      detail: t['签收建议'] || '',
      createdAt: t['创建时间'], doneAt: t['完成时间'],
    };
  }
  if (t.kind === 'payoff') {
    return {
      kind: t.kind, kindLabel: t.kindLabel, id: t['工单号'],
      reason: t['退款问题类型'], status: t['工单状态'],
      detail: `¥${t['退款金额(元)']} · ${t['转账状态']}`,
      createdAt: t['创建时间'], doneAt: t['完成时间'],
    };
  }
  if (t.kind === 'logistics') {
    return {
      kind: t.kind, kindLabel: t.kindLabel, id: t['工单号'],
      reason: t['问题类型'], status: t['工单状态'],
      detail: t['处理方案'] || '',
      createdAt: t['创建时间'], doneAt: t['完成时间'],
    };
  }
  return {
    kind: t.kind, kindLabel: t.kindLabel, id: t['工单号'],
    reason: t['售后原因'], status: t['工单状态'],
    detail: `${t['发出商品名称']} ×${t['数量']}${t['客诉加急'] === '是' ? ' · 加急' : ''}`,
    createdAt: t['创建时间'], doneAt: t['完成时间'],
  };
}

export function buildFusion(session) {
  const hist = buyerHistory(session.buyer, session.id);
  const o = session.order;
  const order = o
    ? {
        id: o['订单号'],
        sku: o['商品货号'],
        name: o['商品名称'],
        qty: o['数量'],
        unitPrice: Number(o['单价(元)'] || 0),
        amount: Number(o['实付金额(元)'] || 0),
        status: o['订单状态'],
        orderedAt: o['下单时间'],
        shippedAt: o['发货时间'],
        courier: o['快递公司'],
        tracking: o['物流单号'],
        region: `${o['收货省']}${o['收货市']}`,
        gift: o['赠品'] || '',
        note: o['买家留言'] || '',
      }
    : null;

  const tickets = session.tickets.map(ticketSummary);
  const priorTickets = hist.priorTickets.map((t) => ({
    kindLabel: t.kindLabel, id: t['工单号'],
    reason: t.kind === 'adverse' ? t['症状描述'] : t[kindReasonField(t)] || '',
    status: t['工单状态'] || t['任务状态'],
  }));

  const highlights = [];
  const visits = hist.priorSessions.length + 1;
  if (visits > 1) {
    highlights.push(`老客户：第 ${visits} 次到店，历史 ${hist.priorOrders.length} 单 / 累计 ¥${hist.totalSpend.toFixed(0)}`);
  } else {
    highlights.push('新客首单会话');
  }
  if (priorTickets.length) {
    const latest = priorTickets[0];
    highlights.push(`历史工单：${latest.kindLabel}「${String(latest.reason).slice(0, 18)}」(${latest.status})`);
  }
  if (order?.note) highlights.push(`本单买家留言：${order.note}`);
  if (order && order.amount >= 500) highlights.push(`高价值订单 ¥${order.amount}`);
  if (tickets.length) highlights.push(`本会话已有 ${tickets.length} 张工单在流程中`);

  const sources = [
    { key: 'chat', label: '聊天记录', ok: true, detail: `${session.stats.msgs} 条消息${session.stats.images ? ` / ${session.stats.images} 张图` : ''}` },
    { key: 'order', label: '订单', ok: !!order, detail: order ? `${order.name.slice(0, 16)} · ¥${order.amount}` : '无关联订单' },
    { key: 'ticket', label: '工单', ok: tickets.length > 0, detail: tickets.length ? tickets.map((t) => t.kindLabel).join('、') : '无关联工单' },
    { key: 'buyer', label: '买家档案', ok: true, detail: visits > 1 ? `老客 · 历史 ${hist.priorOrders.length} 单` : '新客' },
  ];

  return {
    buyer: {
      nickname: session.buyer,
      visits,
      totalOrders: hist.priorOrders.length + (order ? 1 : 0),
      totalSpend: hist.totalSpend + (order?.amount || 0),
      priorTickets,
      priorSessionIds: hist.priorSessions.map((s) => s.id).slice(0, 5),
    },
    order,
    tickets,
    sources,
    highlights,
  };
}

function kindReasonField(t) {
  switch (t.kind) {
    case 'reship': return '售后原因';
    case 'payoff': return '退款问题类型';
    case 'logistics': return '问题类型';
    case 'adverse': return '症状描述';
    case 'return': return '退货原因';
    default: return '工单类型';
  }
}

export { KIND_ACTIONS };
