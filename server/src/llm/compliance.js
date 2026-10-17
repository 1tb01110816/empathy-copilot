// LLM 话术后置合规过滤：命中敏感/超权限承诺时整段替换为规则安全话术
const RULES = [
  {
    code: 'medical_advice',
    label: '医疗诊断/用药建议',
    pattern: /(确诊|诊断为|处方|开药|吃什么药|口服药|涂点药|抗生素|激素药|用药剂量|药膏)/,
  },
  {
    code: 'cure_guarantee',
    label: '治愈/功效保证',
    pattern: /(保证.{0,6}(?:治愈|治好|见效|不过敏|安全|有效)|百分百(?:治愈|有效|解决|不会)|绝对(?:不会|没问题|有效|安全)|永久(?:有效|解决)|根治|药到病除|无副作用|零过敏|三天见效|七天见效|立即见效)/,
  },
  {
    code: 'over_compensation',
    label: '超权限赔付承诺',
    pattern: /(全额(?:赔付|赔偿|退款)|十倍赔偿|假一赔十|双倍赔偿|无条件(?:退款|赔付)|马上(?:赔付|赔偿)|立刻(?:赔付|赔偿))/,
  },
  {
    code: 'off_platform',
    label: '站外联系/私下交易',
    pattern: /(加微信|加我微信|私聊|私下(?:转账|交易|解决)|银行卡转账|扫我.{0,4}码)/,
  },
  {
    code: 'privacy',
    label: '敏感信息收集',
    pattern: /(身份证号|银行卡号|支付密码|短信验证码|手持身份证|完整病历)/,
  },
];

export function scanCompliance(text) {
  const s = String(text || '');
  return RULES.flatMap((rule) => {
    const m = rule.pattern.exec(s);
    return m ? [{ code: rule.code, label: rule.label, match: m[0] }] : [];
  });
}

// 返回可直接发送的安全文本；违规时整段替换，避免模型绕过规则边界
export function filterReply(text, fallback) {
  const violations = scanCompliance(text);
  if (!violations.length) return { text, violations, filtered: false };
  return { text: fallback, violations, filtered: true };
}
