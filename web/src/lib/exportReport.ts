import type { SessionDetail, TraceStep } from '../types';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const RISK_COLOR: Record<string, string> = { red: '#dc2626', yellow: '#d97706', green: '#16a34a' };

const roleName = (m: { isBuyer?: boolean; role: string; simulated?: boolean; live?: boolean }) => {
  if (m.isBuyer) return m.simulated ? '买家（演示模拟）' : '买家';
  return m.simulated ? '客服（演示模拟）' : '客服';
};

const replyText = (d: SessionDetail) => {
  const r = d.analysis.reply;
  return typeof r === 'string' ? r : r?.text || '';
};

// 生成自包含 HTML 演示报告并触发下载（无外部依赖，可直接浏览器打开 / 打印 PDF）
export function exportSessionReport(detail: SessionDetail, trace: TraceStep[] = []) {
  const a = detail.analysis;
  const color = RISK_COLOR[a.risk.level] || '#64748b';

  const sources = (a.fusion.sources || [])
    .map((s) => `<tr><td>${esc(s.label)}</td><td>${s.ok ? '已接入' : '无数据'}</td><td>${esc(s.detail)}</td></tr>`)
    .join('');

  const orderRows = a.fusion.order
    ? [
        `<tr><td>订单号</td><td>${esc(a.fusion.order.id || '')}</td></tr>`,
        `<tr><td>商品</td><td>${esc(a.fusion.order.name || '')} ×${esc(a.fusion.order.qty || '')}</td></tr>`,
        `<tr><td>金额</td><td>¥${esc(a.fusion.order.amount ?? '')}</td></tr>`,
        `<tr><td>状态</td><td>${esc(a.fusion.order.status || '')}</td></tr>`,
        a.fusion.order.courier ? `<tr><td>物流</td><td>${esc(a.fusion.order.courier)} ${esc(a.fusion.order.tracking || '')}</td></tr>` : '',
        a.fusion.order.note ? `<tr><td>买家留言</td><td>${esc(a.fusion.order.note)}</td></tr>` : '',
      ].join('')
    : '<tr><td colspan="2">未关联订单</td></tr>';

  const ticketRows = (a.fusion.tickets || [])
    .map(
      (t) =>
        `<tr><td>${esc(t.kindLabel)}</td><td>${esc(t.id)} · ${esc(t.reason)} · ${esc(t.status)}${t.detail ? ' · ' + esc(t.detail) : ''}</td></tr>`,
    )
    .join('') || '<tr><td colspan="2">未关联工单</td></tr>';

  const highlights = (a.fusion.highlights || []).map((h) => `<li>${esc(h)}</li>`).join('');

  const intentLine = (a.intent.dominant || []).map((d) => `${esc(d.major)}/${esc(d.minor)}`).join(' → ') || '—';
  const peak = a.emotion.peak ? `峰值 ${a.emotion.peak.value}${a.emotion.peak.snippet ? `（${esc(a.emotion.peak.snippet)}）` : ''}` : '—';

  const riskActions = (a.risk.actions || []).map((ac) => esc(ac.label)).join('、') || '—';
  const compliance = (a.risk.compliance || []).map((c) => `· ${esc(c)}`).join('<br>');

  const checks = (a.evaluation.checks || [])
    .map((c) => `<tr><td>${c.ok ? '✓' : '✗'}</td><td>${esc(c.label)}</td><td>${esc(c.detail)}</td></tr>`)
    .join('');

  const messages = detail.messages
    .map((m) => {
      const img = m.imageUrl && String(m.imageUrl).startsWith('data:') ? `<img src="${m.imageUrl}" style="max-width:220px;border-radius:6px;margin-top:4px"/>` : '';
      const tag = m.contentType === '图片' && !img ? `<span style="color:#64748b;font-size:12px">（图片证据，详见工作台）</span>` : '';
      return `<div style="margin:8px 0;padding:10px 12px;border-radius:8px;background:${m.isBuyer ? '#f5f7fb' : '#eef4ff'};border:1px solid ${m.isBuyer ? '#e2e8f0' : '#dbeafe'}">
        <div style="font-size:11px;color:#64748b">${esc(m.time)} · ${esc(roleName(m))}${m.live ? ' · 人工发送' : ''}</div>
        <div style="font-size:13px;color:#1f2329;white-space:pre-wrap;margin-top:2px">${esc(m.text)}</div>${img}${tag}
      </div>`;
    })
    .join('');

  const actions = (detail.runtime.actions || [])
    .map(
      (r) =>
        `<tr><td>${esc(r.id)}</td><td>${esc(r.label)}</td><td>${esc(r.status)}</td><td>${esc(r.at)}</td></tr>`,
    )
    .join('') || '<tr><td colspan="4">本会话未执行动作</td></tr>';

  const traceLine = (trace || [])
    .map((t) => `${esc(t.label)} ${t.ms != null ? `(${t.ms}ms)` : ''}`)
    .join(' → ');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>共情副驾 · 演示报告 ${esc(detail.id)}</title>
<style>
  body{font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;background:#eef1f5;color:#1f2329;margin:0;padding:24px;}
  .wrap{max-width:860px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 2px 12px rgba(15,23,42,.06);}
  h1{font-size:22px;margin:0 0 4px;}
  .sub{color:#64748b;font-size:12px;margin-bottom:18px;}
  h2{font-size:15px;border-left:4px solid #4f46e5;padding-left:10px;margin:22px 0 10px;color:#0f172a;}
  table{border-collapse:collapse;width:100%;font-size:12px;}
  td,th{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#f8fafc;color:#475569;font-weight:600;}
  .risk-badge{display:inline-block;padding:2px 10px;border-radius:999px;color:#fff;font-size:12px;font-weight:600;background:${color};}
  .foot{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.8;}
  ul{margin:6px 0;padding-left:18px;font-size:12px;color:#334155;}
  .reply-box{background:#f5f7fb;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.8;white-space:pre-wrap;}
</style>
</head>
<body>
<div class="wrap">
  <h1>共情副驾 · 演示报告</h1>
  <div class="sub">会话 ${esc(detail.id)} · ${esc(detail.buyer)} · ${esc(detail.shop)} · ${esc(detail.startTime)} → ${esc(detail.endTime)}</div>

  <h2>会话概览</h2>
  <table>
    <tr><th>场景判定</th><td>${esc(a.sceneKey)}</td><th>风险等级</th><td><span class="risk-badge">${esc(a.risk.level)}</span></td></tr>
    <tr><th>消息数</th><td>${detail.stats.msgs} 条${detail.stats.images ? ` / ${detail.stats.images} 张图` : ''}</td><th>情绪状态</th><td>${esc(a.emotion.state)} · ${peak}</td></tr>
    <tr><th>引擎</th><td>${a.engine === 'agent' ? 'Agent（通义千问）' : '规则引擎'}</td><th>话术阶段</th><td>${esc(a.stage || '—')}</td></tr>
  </table>

  <h2>01 多源融合</h2>
  <table><tr><th>来源</th><th>接入</th><th>内容</th></tr>${sources}</table>
  <div style="margin-top:8px">
    <div style="font-size:12px;font-weight:600;color:#475569;margin:6px 0 2px">关联订单</div>
    <table>${orderRows}</table>
    <div style="font-size:12px;font-weight:600;color:#475569;margin:8px 0 2px">关联工单</div>
    <table>${ticketRows}</table>
  </div>
  <ul>${highlights}</ul>

  <h2>02 意图 × 情绪</h2>
  <table>
    <tr><th>意图主线</th><td>${intentLine}</td></tr>
    <tr><th>情绪曲线</th><td>${peak} · 当前 ${esc(a.emotion.current?.value ?? '—')}（${esc(a.emotion.state)}）${a.emotion.turns?.length ? ` · 拐点 ${a.emotion.turns.length} 处` : ''}</td></tr>
  </table>

  <h2>03 风险 × 动作 × 话术</h2>
  <table>
    <tr><th>风险等级</th><td><span class="risk-badge">${esc(a.risk.level)}</span></td></tr>
    <tr><th>判定原因</th><td>${(a.risk.reasons || []).map(esc).join('；') || '—'}</td></tr>
    <tr><th>建议动作</th><td>${riskActions}</td></tr>
    <tr><th>合规提示</th><td>${compliance || '—'}</td></tr>
  </table>
  <div style="font-size:12px;font-weight:600;color:#475569;margin:8px 0 2px">共情话术</div>
  <div class="reply-box">${esc(replyText(detail))}</div>

  <h2>04 验收对账</h2>
  <table><tr><th>结果</th><th>检查项</th><th>说明</th></tr>${checks}</table>
  <div style="margin-top:6px;font-size:12px;color:#334155">${esc(a.evaluation.summary || '')}</div>
  ${traceLine ? `<div style="margin-top:6px;font-size:12px;color:#64748b">Agent 工作流：${traceLine}</div>` : ''}

  <h2>完整对话记录</h2>
  ${messages}

  <h2>已执行动作</h2>
  <table><tr><th>单号</th><th>动作</th><th>状态</th><th>时间</th></tr>${actions}</table>

  <div class="foot">
    本报告由「共情副驾 Empathy Copilot」导出（欧莱雅第二届美妆科技黑客松 · 赛题一「数据共情者」参赛作品）。<br>
    全部数据为赛题 MOCK 虚构数据，仅供演示；风险分级与合规提示为业务演示口径，不构成医疗建议。
  </div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `共情副驾-${detail.id}-演示报告.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
