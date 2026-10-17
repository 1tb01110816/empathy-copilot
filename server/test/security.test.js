import test from 'node:test';
import assert from 'node:assert/strict';
import { accessGuard, createRateLimiter, securityHeaders } from '../src/security.js';

function mockReq({ method = 'GET', path = '/api/overview', auth = '', ip = '127.0.0.1' } = {}) {
  return {
    method,
    path,
    ip,
    headers: auth ? { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {},
    socket: { remoteAddress: ip },
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function run(guard, req) {
  const res = mockRes();
  let passed = false;
  guard(req, res, () => { passed = true; });
  return { res, passed };
}

test('accessGuard: 未配置口令时直接放行', () => {
  delete process.env.APP_ACCESS_CODE;
  const { passed, res } = run(accessGuard, mockReq());
  assert.equal(passed, true);
  assert.equal(res.statusCode, 200);
});

test('accessGuard: 配置口令后拒绝无凭证请求', () => {
  process.env.APP_ACCESS_CODE = 'secret-123';
  process.env.APP_AUTH_USER = 'demo';
  const { passed, res } = run(accessGuard, mockReq());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['www-authenticate'], /Basic realm/);
  delete process.env.APP_ACCESS_CODE;
});

test('accessGuard: 正确口令放行，错误口令拒绝', () => {
  process.env.APP_ACCESS_CODE = 'secret-123';
  process.env.APP_AUTH_USER = 'demo';
  assert.equal(run(accessGuard, mockReq({ auth: 'demo:secret-123' })).passed, true);
  assert.equal(run(accessGuard, mockReq({ auth: 'demo:wrong' })).passed, false);
  delete process.env.APP_ACCESS_CODE;
});

test('accessGuard: /api/health 免鉴权', () => {
  process.env.APP_ACCESS_CODE = 'secret-123';
  assert.equal(run(accessGuard, mockReq({ path: '/api/health' })).passed, true);
  delete process.env.APP_ACCESS_CODE;
});

test('createRateLimiter: 超过窗口上限返回 429 并带 Retry-After', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(run(limiter, mockReq()).passed, true);
  const { passed, res } = run(limiter, mockReq());
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['retry-after']) >= 1);
});

test('createRateLimiter: 支持按条件跳过', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, skip: (req) => req.path === '/health' });
  assert.equal(run(limiter, mockReq({ path: '/health' })).passed, true);
  assert.equal(run(limiter, mockReq({ path: '/health' })).passed, true);
  assert.equal(run(limiter, mockReq({ path: '/api/overview' })).passed, true);
  assert.equal(run(limiter, mockReq({ path: '/api/overview' })).passed, false);
});

test('securityHeaders: 设置基础安全响应头', () => {
  const res = mockRes();
  let passed = false;
  securityHeaders({}, res, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});
