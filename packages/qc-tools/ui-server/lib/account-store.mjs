import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { ROOT_DIR } from '../../project-paths.mjs';

const scrypt = promisify(scryptCallback);

export function openAccountStore(directory = process.env.WHYVIDEO_AUTH_DIR || path.join(ROOT_DIR, '.whyvideo-auth')) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'accounts.sqlite'));
  const delegates = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'superuser')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_owners (
      project_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id)
    );
  `);

  return {
    async createFirstSuperuser(username, password) {
      const name = typeof username === 'string' ? username.trim() : '';
      if (!name || name.length > 128 || typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('账号信息无效');
      const salt = randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('账号已初始化');
        db.prepare('INSERT INTO users (id, username, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), name, salt, hash, 'superuser', new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    hasUsers() {
      return db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
    },
    listUsers() {
      return db.prepare('SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY created_at').all();
    },
    setUserActive(id, active) {
      const result = db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'user'").run(active ? 1 : 0, id);
      if (!active && result.changes) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return result.changes > 0;
    },
    async resetPassword(id, password) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('密码长度须为 12 至 1024 个字符');
      const salt = randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      if (!db.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').run(salt, hash, id).changes) throw new Error('账号不存在');
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    },
    assignProject(projectId, userId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('无效的工程 ID');
      if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(userId)) {
        throw new Error('账号不存在或已停用');
      }
      db.prepare('INSERT INTO project_owners (project_id, user_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET user_id = excluded.user_id').run(projectId, userId);
    },
    assignUnownedProject(projectId, userId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('无效的工程 ID');
      if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(userId)) throw new Error('账号不存在或已停用');
      return db.prepare('INSERT OR IGNORE INTO project_owners (project_id, user_id) VALUES (?, ?)').run(projectId, userId).changes === 1;
    },
    getProjectOwner(projectId) {
      return db.prepare('SELECT user_id AS userId FROM project_owners WHERE project_id = ?').get(projectId)?.userId ?? null;
    },
    removeProjectOwner(projectId) {
      db.prepare('DELETE FROM project_owners WHERE project_id = ?').run(projectId);
    },
    canReadProject(user, projectId) {
      if (!user || !/^[a-zA-Z0-9_-]+$/.test(projectId)) return false;
      return user.role === 'superuser' || this.getProjectOwner(projectId) === user.id;
    },
    canWriteProject(user, projectId) {
      if (!user || !/^[a-zA-Z0-9_-]+$/.test(projectId)) return false;
      return user.role === 'superuser' || this.getProjectOwner(projectId) === user.id;
    },
    setProjectDelegate(projectId, userId, expiresAt) {
      if (userId) delegates.set(projectId, { userId, expiresAt });
      else delegates.delete(projectId);
    },
    async createUser(username, password, role = 'user') {
      const name = typeof username === 'string' ? username.trim() : '';
      if (!name || name.length > 128) throw new Error('用户名长度须为 1 至 128 个字符');
      if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
        throw new Error('密码长度须为 12 至 1024 个字符');
      }
      if (!['user', 'superuser'].includes(role)) throw new Error('无效的账号角色');
      const salt = randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      const user = { id: randomUUID(), username: name, role, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO users (id, username, password_salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, user.username, salt, hash, role, user.createdAt);
      return user;
    },

    async verifyPassword(username, password) {
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024) return null;
      const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim());
      const salt = row ? Buffer.from(row.password_salt) : Buffer.alloc(16);
      const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(64);
      const actual = await scrypt(password, salt, 64);
      if (!timingSafeEqual(actual, expected) || !row || !row.active) return null;
      return { id: row.id, username: row.username, role: row.role };
    },

    createSession(userId) {
      const token = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash, userId, expiresAt);
      return token;
    },

    getSession(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const hash = createHash('sha256').update(token).digest('hex');
      const row = db.prepare('SELECT users.id, users.username, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1').get(hash, Date.now());
      return row || null;
    },

    deleteSession(token) {
      if (typeof token !== 'string') return;
      const hash = createHash('sha256').update(token).digest('hex');
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    },

    close() {
      db.close();
    },
  };
}
