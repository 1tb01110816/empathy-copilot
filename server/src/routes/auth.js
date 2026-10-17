// 访问口令登录：登录页 POST 口令 → 签发 HttpOnly 会话 Cookie；/enter?code=... 为邀请链接
// 该路由挂载在 accessGuard 之前，仅放行登录所需的端点；其余 /api 仍受保护
import { Router } from 'express';
import {
  accessEnabled,
  clearSession,
  createRateLimiter,
  hasSession,
  issueSession,
  verifyAccessCode,
} from '../security.js';

const auth = Router();

const loginLimiter = createRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.LOGIN_RATE_MAX || 10),
  message: '尝试次数过多，请稍后再试',
});

auth.get('/api/auth/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: accessEnabled(), authenticated: hasSession(req) });
});

auth.post('/api/auth/login', loginLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!accessEnabled()) return res.json({ ok: true, enabled: false });
  const code = req.body?.code;
  if (typeof code !== 'string' || !code || code.length > 200) {
    return res.status(400).json({ error: '请输入访问口令', code: 'CODE_REQUIRED' });
  }
  if (!verifyAccessCode(code)) {
    return res.status(401).json({ error: '口令不正确', code: 'INVALID_CODE' });
  }
  issueSession(req, res);
  return res.json({ ok: true, enabled: true });
});

auth.post('/api/auth/logout', (req, res) => {
  res.set('Cache-Control', 'no-store');
  clearSession(req, res);
  res.json({ ok: true });
});

// 邀请链接：口令校验通过后写入 Cookie 并跳转到干净地址，口令不留在地址栏
auth.get('/enter', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!accessEnabled()) return res.redirect('/');
  if (!code) return res.redirect('/?auth=required');
  if (!verifyAccessCode(code)) return res.redirect('/?auth=failed');
  issueSession(req, res);
  return res.redirect('/');
});

export default auth;
