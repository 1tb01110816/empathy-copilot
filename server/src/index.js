import 'dotenv/config';
import app from './app.js';
import { accessEnabled } from './security.js';
import { llmAvailable, textModel, vlModel } from './llm/qwen.js';
import { datasetStats, initStore } from './store.js';
import { initRuntimeFromDb } from './actions.js';

const PORT = Number(process.env.PORT || 8787);

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
  console.log(accessEnabled()
    ? '  访问口令：已启用（登录页 / 邀请链接 /enter?code=…，7 天免登录；Basic Auth 兼容；/api/health 免鉴权）'
    : '  访问口令：未启用（本地开发模式，公网部署请设置 APP_ACCESS_CODE）');
  console.log('──────────────────────────────────────────────');
});
