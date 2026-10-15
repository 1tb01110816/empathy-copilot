// 通义千问提示词：客服共情话术 / 5 秒摘要 / 情绪复评 / 图片证据理解

const LV = { red: '红（高优先）', yellow: '黄（需关注）', green: '绿（常规）' };

function contextBlock(analysis, session) {
  const { fusion, intent, emotion, risk } = analysis;
  const lines = [];
  lines.push(`【买家】${fusion.buyer.nickname}，${fusion.buyer.visits > 1 ? `老客户（第${fusion.buyer.visits}次到店，历史累计 ¥${fusion.buyer.totalSpend.toFixed(0)}）` : '新客户'}`);
  if (fusion.order) {
    const o = fusion.order;
    lines.push(`【订单】${o.name} ×${o.qty}，实付 ¥${o.amount}，状态：${o.status}，物流：${o.courier} ${o.tracking}，收货地：${o.region}${o.gift ? `，赠品：${o.gift}` : ''}${o.note ? `，买家留言：${o.note}` : ''}`);
  }
  lines.push(`【工单】${fusion.tickets.length ? fusion.tickets.map((t) => `${t.kindLabel}(${t.reason}｜${t.status})`).join('；') : '无'}`);
  if (fusion.buyer.priorTickets.length) {
    lines.push(`【历史工单】${fusion.buyer.priorTickets.map((t) => `${t.kindLabel}(${t.reason}｜${t.status})`).join('；')}`);
  }
  const top = intent.dominant[0];
  lines.push(`【识别意图】${top ? `${top.major}/${top.minor}` : '未识别'}${intent.switched ? '（会话中存在意图切换）' : ''}`);
  lines.push(`【情绪】当前 ${emotion.state}（${emotion.current?.value ?? '-'}），峰值 ${emotion.peak?.value ?? '-'}${emotion.turns.length ? `，拐点 ${emotion.turns.map((t) => `第${t.seq}条${t.dir === 'up' ? '↑升级' : '↓缓和'}`).join('、')}` : ''}`);
  lines.push(`【风险】${LV[risk.level]}；依据：${risk.reasons.join('；')}`);
  lines.push(`【建议动作】${risk.actions.map((a) => a.label).join('；')}`);
  if (risk.compliance.length) lines.push(`【合规边界】${risk.compliance.join('；')}`);

  const recent = session.messages.filter((m) => m.seq <= analysis.uptoSeq).slice(-6);
  if (recent.length) {
    lines.push('【最近对话】');
    for (const m of recent) {
      lines.push(`${m.role === '买家' ? '买家' : m.role === '客服' ? '客服' : '系统'}：${m.contentType === '图片' ? `[发送图片] ${m.text}` : m.text}`);
    }
  }
  return lines.join('\n');
}

// 对话阶段话术指引：开场共情 → 跟进推进 → 收尾安抚（与规则引擎阶段判定对齐）
const STAGE_GUIDE = {
  opening: '当前阶段：开场共情（买家刚提出诉求）。先共情安抚、再给解决方案、最后给确定性承诺。',
  followup: '当前阶段：跟进推进（买家已收到首轮共情回复，提出了最新反馈或仍在等待进展）。请承接买家的最新反馈，不要重复开场的长道歉；给出具体的推进安排与确定性承诺，让买家感到被持续跟进、不必反复来问。',
  closing: '当前阶段：收尾安抚（买家已表达认可、问题接近闭环）。请生成温暖的收尾安抚话术：感谢理解与耐心、闭环承诺（持续跟进/进度主动同步）、以祝福告别收尾；不要引入新的处理方案或上下文没有的承诺。',
};

export function scriptMessages(analysis, session, referenceReply) {
  const system = [
    '你是美妆品牌「测试美妆旗舰店」的金牌客服话术助手，为客服生成一条可直接发送给买家的回复建议。',
    STAGE_GUIDE[analysis.stage] || STAGE_GUIDE.opening,
    '风格要求：先共情安抚、再给解决方案、最后给确定性承诺（时限/单号/路径）；口吻亲切专业，用「亲亲/您」，可以带一个语气词但不要浮夸；长度 60-130 字。',
    '合规要求：不做医疗诊断或用药建议；不良反应场景只做停用提醒、登记、回访与就医指引；空包裹等风控场景不做未经核实的前置赔付承诺；补偿方案以平台可执行为准；不得编造上下文里没有的信息（单号、金额、时限只能来自上下文或参考口径）。',
    '如果你判断买家情绪明显不满，回复中必须包含一句具体的共情表达。',
    '输出 JSON：{"reply": "回复文本", "tone": "情绪基调(如 安抚+方案)", "notes": ["给客服的1-2条提示，如合规边界/风险点"]}',
  ].join('\n');
  const user = [
    contextBlock(analysis, session),
    referenceReply ? `【历史相似案例的处理口径（可参考措辞与方案，不要照抄数字以外的新信息）】\n${referenceReply}` : '',
    '请生成这次回复建议。',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

export function summaryMessages(analysis, session) {
  const system = [
    '你是客服工作台的会话摘要助手。基于多源融合数据，为客服生成「5 秒看懂」的会话摘要。',
    '输出 JSON：{"headline": "一句话说清买家是谁+本次诉求+关键状态（40字内）", "focus": ["2-3个客服必须注意的点，各20字内"], "reasoning": "一句话说明你融合了哪些数据源"}',
  ].join('\n');
  const user = contextBlock(analysis, session) + '\n请输出摘要 JSON。';
  return { system, user };
}

export function emotionMessages(analysis, session) {
  const buyers = session.messages.filter((m) => m.isBuyer && m.seq <= analysis.uptoSeq);
  const system = [
    '你是客服对话情绪分析器。对每条买家消息给出「情绪压力分」0-100（越高越负面、压力越大），只评估情绪强度，不考虑业务严重性。',
    '锚点：5 非常满意；15 满意/轻松；25 中性咨询；40 轻度不满或焦虑；55 明显不满；70 愤怒；85 激烈冲突（威胁/辱骂）。',
    '输出 JSON：{"scores": [{"seq": 1, "score": 40, "note": "简短依据"}]}，必须覆盖所有输入消息的 seq。',
  ].join('\n');
  const user = buyers.map((m) => `seq=${m.seq}：${m.text}`).join('\n');
  return { system, user };
}

export const EVIDENCE_FALLBACK = {
  broken_pump: { verdict: '商品破损（泵头/瓶身）', findings: ['商品外观存在明显破损痕迹', '与“泵头按不出/漏液”的描述吻合'], suggestion: '按破损换货流程处理：保留照片证据，创建补发换货工单' },
  broken_parcel: { verdict: '包裹外箱破损', findings: ['外箱有明显变形/破损痕迹', '内件可能受影响'], suggestion: '引导拍摄内件状态，按包裹破损流程补发并联系快递追责' },
  short_item: { verdict: '少件/漏发凭证', findings: ['开箱后商品数量与订单清单不符', '面单与包裹为原包装'], suggestion: '核验出库记录后创建补发工单' },
  missing_item: { verdict: '漏发凭证', findings: ['赠品/小样未随包裹出现', '订单记录显示应有赠品'], suggestion: '核验订单赠品记录后补发' },
  wrong_shade: { verdict: '色号错发对比', findings: ['实物色号与订单色号不一致'], suggestion: '确认色号后安排换货/补发，运费店铺承担' },
  refund_screenshot: { verdict: '退款/订单截图', findings: ['截图为平台退款或订单状态页'], suggestion: '核对退款单号与到账进度，必要时线下补打' },
  live_promise: { verdict: '直播间承诺截图', findings: ['截图包含直播承诺的赠品/价格信息'], suggestion: '核对直播承诺记录，兑现权益并同步进度' },
  swatch: { verdict: '试色/肤色参考图', findings: ['买家提供肤色或试色参考'], suggestion: '结合肤色推荐色号或提供试色建议' },
  logistics_screenshot: { verdict: '物流轨迹截图', findings: ['物流长时间未更新/轨迹异常'], suggestion: '联系快递核实，超 48 小时按停滞流程处理' },
  consult_card: { verdict: '商品咨询卡片', findings: ['买家咨询指定商品'], suggestion: '结合商品信息进行售前解答' },
  empty_parcel: { verdict: '空箱/外箱照片', findings: ['需核验外箱与面单完整性'], suggestion: '按空包裹风控流程：留存证据、核验出库称重、转风控核实' },
  upload: { verdict: '买家上传图片', findings: ['买家上传了实物照片，待模型/人工解读'], support: '中性', suggestion: '请结合图片内容人工复核后处理' },
};

export function evidencePrompt(category) {
  const system = [
    '你是电商售后证据图审阅助手（多模态）。审阅买家在客服会话中发来的图片，输出对处理有价值的客观发现，不要臆测图片中不存在的信息，看不清就明确说明。',
    '输出 JSON：{"verdict": "图片判定(如 包裹破损/商品破损/少件凭证/色号对比/截图类/其它)", "findings": ["客观发现1","客观发现2"], "support": "支持买家诉求|中性|建议人工复核", "suggestion": "给客服的下一步建议(一句话)"}',
  ].join('\n');
  const hint = EVIDENCE_FALLBACK[category] ? `参考语境（不能直接采信，仅帮助理解）：这张图在系统中被归类为「${EVIDENCE_FALLBACK[category].verdict}」。` : '';
  return { system, user: `${hint}请审阅这张买家发来的证据图片并输出 JSON。` };
}
