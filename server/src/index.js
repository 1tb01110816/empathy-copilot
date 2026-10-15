import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './routes/api.js';
import { llmAvailable, textModel, vlModel } from './llm/qwen.js';
import { datasetStats, initStore } from './store.js';
import { initRuntimeFromDb } from './actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use('/api', api);

// 生产模式：托管前端构建产物
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: String(err.message || err) });
});

// 先完成数据层初始化（MySQL 或 JSON 降级），再对外提供服务
const status = await initStore();
await initRuntimeFromDb();

app.listen(PORT, () => {
  const stats = datasetStats();
  console.log('──────────────────────────────────────────────');
  console.log('  共情副驾 Empathy Copilot · API Server');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  数据：${stats.sessions} 会话 / ${stats.messages} 消息 / ${stats.orders} 订单 / ${stats.tickets} 工单`);
  console.log(status.mode === 'mysql'
    ? `  存储：MySQL 已接入（${status.database} @ ${status.host}，试跑记录持久化）`
    : `  存储：JSON + 内存模式（未接入 MySQL：${status.reason}）`);
  console.log(llmAvailable()
    ? `  通义千问：已启用（${textModel()} + ${vlModel()}）`
    : '  通义千问：未配置 DASHSCOPE_API_KEY，当前为规则引擎模式（server/.env 填入 Key 后自动启用）');
  console.log('──────────────────────────────────────────────');
});
