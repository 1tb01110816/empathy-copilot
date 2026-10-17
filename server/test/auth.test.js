// 登录 / 邀请链接 / 会话 Cookie 的端到端行为（独立进程，避开本机 MySQL 与真实 Key）
process.env.DB_HOST = '';
process.env.DASHSCOPE_API_KEY = '';
process.env.APP_ACCESS_CODE = 'auth-test-code';
process.env.APP_SESSION_SECRET = 'auth-test-secret';
process.env.APP_AUTH_USER = 'demo';
process.env.LOGIN_RATE_MAX = '1000';

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import auth from '../src/routes/auth.js';
import { accessGuard, sessionCookieName } from '../src/security.js';

const app = express();
app.use(express.json());
app.use(auth);
app.use('/api', accessGuard, (req, res) => res.json({ ok: true, path: req.path }));

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

test('auth: 未登录时 session 端点公开可读，业务 API 返回 401 JSON', async () => {
  const session = await fetch(`${base}/api/auth/session`).then((r) => r.json());
  assert.deepEqual(session, { enabled: true, authenticated: false });

  const res = await fetch(`${base}/api/overview`);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), null);
  assert.equal((await res.json()).code, 'AUTH_REQUIRED');
});

test('auth: /api/health 保持免鉴权', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('auth: 错误口令 401 且不下发 Cookie，缺失口令 400', async () => {
  const wrong = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'wrong' }),
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).code, 'INVALID_CODE');
  assert.equal(wrong.headers.get('set-cookie'), null);

  const missing = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'CODE_REQUIRED');
});

test('auth: 正确口令签发 Cookie，凭 Cookie 访问业务 API', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'auth-test-code' }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${sessionCookieName}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = cookieFrom(login);
  const ok = await fetch(`${base}/api/overview`, { headers: { cookie } });
  assert.equal(ok.status, 200);

  const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } }).then((r) => r.json());
  assert.equal(session.authenticated, true);

  const tampered = await fetch(`${base}/api/overview`, { headers: { cookie: `${cookie}x` } });
  assert.equal(tampered.status, 401);
});

test('auth: Basic Auth 兼容仍然可用', async () => {
  const authHeader = `Basic ${Buffer.from('demo:auth-test-code').toString('base64')}`;
  const res = await fetch(`${base}/api/overview`, { headers: { authorization: authHeader } });
  assert.equal(res.status, 200);
});

test('auth: 邀请链接校验口令并跳转干净地址', async () => {
  const ok = await fetch(`${base}/enter?code=auth-test-code`, { redirect: 'manual' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/');
  const cookie = cookieFrom(ok);
  assert.match(cookie, new RegExp(`^${sessionCookieName}=`));
  assert.equal((await fetch(`${base}/api/overview`, { headers: { cookie } })).status, 200);

  const failed = await fetch(`${base}/enter?code=nope`, { redirect: 'manual' });
  assert.equal(failed.status, 302);
  assert.equal(failed.headers.get('location'), '/?auth=failed');
  assert.equal(failed.headers.get('set-cookie'), null);

  const missing = await fetch(`${base}/enter`, { redirect: 'manual' });
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get('location'), '/?auth=required');
});

test('auth: 退出登录清除 Cookie', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${sessionCookieName}=;`));
  assert.match(setCookie, /Expires=/);
});
