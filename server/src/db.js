// MySQL 接入层：未配置 DB_HOST 或连接失败时自动降级为 JSON + 内存模式（现有演示行为不变）
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export const MOCK_TABLES = ['chat', 'orders', 'tickets_reship', 'tickets_payoff', 'tickets_logistics', 'tickets_adverse', 'tickets_return', 'datadict'];

const CONF = {
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'empathy_copilot',
};

let pool = null;
let mode = 'memory';
let reason = CONF.host ? '' : '未配置 DB_HOST（server/.env）';

export const dbMode = () => mode;

export const dbStatus = () => ({
  mode,
  reason,
  host: pool ? `${CONF.host}:${CONF.port}` : null,
  database: pool ? CONF.database : null,
});

export const dbQuery = (sql, params) => pool.query(sql, params);

const qi = (name) => `\`${String(name).replace(/`/g, '``')}\``;

export async function connectDb() {
  if (pool) return true;
  if (!CONF.host) return false;
  if (!/^[A-Za-z0-9_]+$/.test(CONF.database)) {
    reason = `DB_NAME 不合法：${CONF.database}`;
    return false;
  }
  try {
    const boot = await mysql.createConnection({
      host: CONF.host,
      port: CONF.port,
      user: CONF.user,
      password: CONF.password,
      connectTimeout: 4000,
    });
    await boot.query(`CREATE DATABASE IF NOT EXISTS ${qi(CONF.database)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await boot.end();
    pool = mysql.createPool({ ...CONF, waitForConnections: true, connectionLimit: 4, charset: 'utf8mb4' });
    await pool.query('SELECT 1');
    mode = 'mysql';
    reason = '';
    return true;
  } catch (e) {
    pool = null;
    mode = 'memory';
    reason = String(e.message || e).slice(0, 160);
    return false;
  }
}

export async function dbDemote(reasonText) {
  if (pool) {
    try {
      await pool.end();
    } catch {
      /* 连接已失效则忽略 */
    }
  }
  pool = null;
  mode = 'memory';
  reason = String(reasonText || '').slice(0, 160);
}

// CLI 脚本收尾用：关闭连接池，否则进程被挂住的连接阻止退出
export async function closeDb() {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    /* 忽略 */
  }
  pool = null;
}

export async function mockTablesReady() {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)',
    [CONF.database, MOCK_TABLES],
  );
  return Number(rows[0].n) === MOCK_TABLES.length;
}

// 从 server/data/*.json 建同构表并导入（幂等：每次重建这 8 张 MOCK 表，不触碰试跑/运行时表）
export async function importMockData() {
  const summary = [];
  for (const name of MOCK_TABLES) {
    const [header, ...body] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
    const rows = body.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    const cols = header.map((h) => qi(h)).join(', ');
    await pool.query(`DROP TABLE IF EXISTS ${qi(name)}`);
    await pool.query(
      `CREATE TABLE ${qi(name)} (${header.map((h) => `${qi(h)} TEXT`).join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300).map((r) => header.map((_, j) => String(r[j] ?? '')));
      if (chunk.length) await pool.query(`INSERT INTO ${qi(name)} (${cols}) VALUES ?`, [chunk]);
    }
    summary.push({ table: name, rows: rows.length });
  }
  return summary;
}

// 读取单张 MOCK 表，返回与 JSON 相同的 [header, ...rows] 结构
export async function loadMockRows(name) {
  const [cols] = await pool.query(
    'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [CONF.database, name],
  );
  const header = cols.map((r) => r.c);
  const [rows] = await pool.query({ sql: `SELECT * FROM ${qi(name)}`, rowsAsArray: true });
  return [header, ...rows.map((r) => r.map((v) => (v === null ? '' : String(v))))];
}

export async function ensureTryTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS try_sessions (
      id VARCHAR(32) PRIMARY KEY,
      buyer VARCHAR(64) NOT NULL DEFAULT '',
      shop VARCHAR(128) NOT NULL DEFAULT '',
      start_time VARCHAR(32) NOT NULL DEFAULT '',
      end_time VARCHAR(32) NOT NULL DEFAULT '',
      created_at VARCHAR(32) NOT NULL DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS try_messages (
      id VARCHAR(64) PRIMARY KEY,
      session_id VARCHAR(32) NOT NULL,
      seq INT NOT NULL,
      time VARCHAR(32) NOT NULL DEFAULT '',
      role VARCHAR(16) NOT NULL DEFAULT '',
      sender VARCHAR(64) NOT NULL DEFAULT '',
      is_buyer TINYINT NOT NULL DEFAULT 0,
      simulated TINYINT NOT NULL DEFAULT 0,
      live TINYINT NOT NULL DEFAULT 0,
      text MEDIUMTEXT,
      content_type VARCHAR(16) NOT NULL DEFAULT '文本',
      image_url MEDIUMTEXT,
      KEY idx_try_msg_session (session_id),
      CONSTRAINT fk_try_msg_session FOREIGN KEY (session_id) REFERENCES try_sessions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS runtime_actions (
      id VARCHAR(40) PRIMARY KEY,
      session_id VARCHAR(32) NOT NULL,
      type VARCHAR(32) NOT NULL DEFAULT '',
      label VARCHAR(64) NOT NULL DEFAULT '',
      at VARCHAR(32) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT '',
      fields_json MEDIUMTEXT,
      KEY idx_runtime_action_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS runtime_messages (
      seq INT PRIMARY KEY,
      session_id VARCHAR(32) NOT NULL,
      time VARCHAR(32) NOT NULL DEFAULT '',
      text MEDIUMTEXT,
      KEY idx_runtime_msg_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}
