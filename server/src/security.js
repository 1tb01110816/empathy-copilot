import crypto from 'node:crypto';

export function accessEnabled() {
  return !!process.env.APP_ACCESS_CODE;
}

function sameSecret(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Basic Auth 访问口令：未配置 APP_ACCESS_CODE 时保持本地开放，/api/health 始终免鉴权
export function accessGuard(req, res, next) {
  if (!accessEnabled() || req.method === 'OPTIONS' || req.path === '/api/health') return next();
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  let ok = false;
  if (scheme === 'Basic' && encoded) {
    const expected = Buffer.from(`${process.env.APP_AUTH_USER || 'demo'}:${process.env.APP_ACCESS_CODE}`);
    try {
      ok = sameSecret(Buffer.from(encoded, 'base64'), expected);
    } catch {
      ok = false;
    }
  }
  if (ok) return next();
  res.set('WWW-Authenticate', 'Basic realm="Empathy Copilot", charset="UTF-8"');
  return res.status(401).json({ error: '需要访问口令' });
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
