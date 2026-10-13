import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'job-hunter.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    company TEXT,
    location TEXT,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    tag TEXT NOT NULL,
    posted_at TEXT,
    discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    alerted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT NOT NULL,
    found_count INTEGER NOT NULL DEFAULT 0,
    message TEXT
  );
`);

export function saveJob(job) {
  const result = db.prepare(`INSERT OR IGNORE INTO jobs
    (fingerprint,title,company,location,url,source,tag,posted_at,description)
    VALUES (@fingerprint,@title,@company,@location,@url,@source,@tag,@postedAt,@description)`).run(job);
  return result.changes === 1 ? Number(result.lastInsertRowid) : null;
}

export function jobs({ limit = 100, tag, search } = {}) {
  const where = [];
  const params = [];
  if (tag && tag !== 'All') { where.push('tag = ?'); params.push(tag); }
  if (search) { where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM jobs ${clause} ORDER BY discovered_at DESC LIMIT ?`).all(...params, Number(limit));
}
export const stats = () => db.prepare(`SELECT COUNT(*) total, SUM(alerted_at IS NOT NULL) alerted, SUM(tag='Google Form') forms, SUM(tag='Walk-in') walkins, SUM(tag='Direct') direct FROM jobs`).get();
export const latestScan = () => db.prepare('SELECT * FROM scans ORDER BY id DESC LIMIT 1').get();
export const startScan = () => db.prepare("INSERT INTO scans (status) VALUES ('running')").run().lastInsertRowid;
export const finishScan = (id, status, found, message = null) => db.prepare('UPDATE scans SET finished_at=CURRENT_TIMESTAMP,status=?,found_count=?,message=? WHERE id=?').run(status, found, message, id);
export function unalerted(ids) { return db.prepare(`SELECT * FROM jobs WHERE id IN (${ids.map(() => '?').join(',')}) AND alerted_at IS NULL`).all(...ids); }
export function markAlerted(ids) { if (ids.length) db.prepare(`UPDATE jobs SET alerted_at=CURRENT_TIMESTAMP WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids); }
