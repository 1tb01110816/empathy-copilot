// Express 应用装配（不监听端口，供 index.js 与接口测试复用）
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './routes/api.js';
import { accessGuard, securityHeaders } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const app = express();
if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');
app.use(cors());
app.use(securityHeaders);
app.use(accessGuard);
app.use(express.json({ limit: '4mb' }));
app.use('/api', api);

// 生产模式：托管前端构建产物
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大（上限 4MB）' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体不是合法 JSON' });
  console.error('[error]', err);
  res.status(500).json({ error: String(err.message || err) });
});

export default app;
