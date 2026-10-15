// 数据导入：server/data/*.json → MySQL（需先在 server/.env 配置 DB_HOST/DB_USER/DB_PASSWORD 等）
// 用法：npm run db:import -w server
import { connectDb, importMockData, ensureTryTables, dbStatus, closeDb } from '../src/db.js';

const ok = await connectDb();
if (!ok) {
  console.error(`MySQL 连接失败：${dbStatus().reason || '未知错误'}`);
  console.error('请检查 server/.env 中的 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME');
  process.exit(1);
}

const summary = await importMockData();
await ensureTryTables();

const st = dbStatus();
console.log('──────── MySQL 导入完成 ────────');
for (const { table, rows } of summary) console.log(`  ${table.padEnd(20)} ${rows} 行`);
console.log(`  数据库: ${st.database} @ ${st.host}`);
console.log('  试跑/运行时表已就绪: try_sessions / try_messages / runtime_actions / runtime_messages');
await closeDb();
