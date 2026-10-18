import crypto from 'node:crypto';

const SESSION_COOKIE = 'ec_auth';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const sessionCookieName = SESSION_COOKIE;

export function accessEnabled() {
  return !!process.env.APP_ACCESS_CODE;
}

function sameSecret(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function verifyAccessCode(code) {
  if (!accessEnabled()) return false;
  return sameSecret(String(code || ''), process.env.APP_ACCESS_CODE);
}

// 会话密钥始终混入访问口令：换口令即让全部旧 Cookie 失效（可选 APP_SESSION_SECRET 再加一层）
function sessionKey() {
  return `${process.env.APP_SESSION_SECRET || 'empathy-copilot-local'}:${process.env.APP_ACCESS_CODE || ''}`;
}

function signExpiry(exp) {
  return crypto.createHmac('sha256', sessionKey()).update(String(exp)).digest('base64url');
}

function readCookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function hasCookieSession(req) {
  const raw = readCookie(req, SESSION_COOKIE);
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const expStr = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now() || exp > Date.now() + SESSION_TTL_MS + 60_000) return false;
  return sameSecret(sig, signExpiry(expStr));
}

// Basic Auth 兼容：老链接 / curl -u 仍可使用，但不再主动弹浏览器原生框
function hasBasicAuth(req) {
  const [scheme, encoded] = String(req.headers?.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const expected = Buffer.from(`${process.env.APP_AUTH_USER || 'demo'}:${process.env.APP_ACCESS_CODE}`);
  try {
    return sameSecret(Buffer.from(encoded, 'base64'), expected);
  } catch {
    return false;
  }
}

export function hasSession(req) {
  if (!accessEnabled()) return true;
  return hasCookieSession(req) || hasBasicAuth(req);
}

export function issueSession(req, res) {
  const exp = Date.now() + SESSION_TTL_MS;
  const value = `${exp}.${signExpiry(exp)}`;
  if (typeof res.cookie === 'function') {
    res.cookie(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!req.secure,
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`,
    );
  }
}

export function clearSession(req, res) {
  if (typeof res.clearCookie === 'function') {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return;
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function accessGuard(req, res, next) {
  if (!accessEnabled() || req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health') return next();
  if (hasSession(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(401).json({ error: '需要访问口令', code: 'AUTH_REQUIRED' });
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(req) {
  const origin = req.headers?.origin;
  // 无 Origin 视为非浏览器请求（curl / 服务间调用），口令仍由 accessGuard 校验
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Cookie 会自动随请求发送，写接口额外校验 Origin 防跨站伪造；
// Basic Auth 需显式携带 Authorization，不属于 CSRF 场景，直接放行
export function csrfGuard(req, res, next) {
  if (!accessEnabled() || !UNSAFE_METHODS.has(req.method)) return next();
  if (/^Basic /i.test(String(req.headers?.authorization || ''))) return next();
  if (sameOrigin(req)) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(403).json({ error: '跨站请求被拒绝', code: 'ORIGIN_FORBIDDEN' });
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

export function createRateLimiter({ windowMs = 60_000, max = 240, message = '请求过于频繁，请稍后再试', skip } = {}) {
  const buckets = new Map();
  return function rateLimiter(req, res, next) {
    if (skip?.(req)) return next();
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    next();
  };
}
