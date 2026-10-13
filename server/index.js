import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJob, jobs, stats, latestScan, startScan, finishScan, unalerted, markAlerted } from './db.js';
import { googleJobs, googleForms, companyBoards, walkIns } from './sources.js';
import { sendTelegram } from './telegram.js';

const app = express();
app.use(cors());
app.use(express.json());
let scanning = false;

async function scan() {
  if (scanning) return { skipped: true, reason: 'A scan is already running' };
  scanning = true;
  const scanId = startScan();
  try {
    const outcomes = await Promise.allSettled([googleJobs(), googleForms(), companyBoards(), walkIns()]);
    const candidates = outcomes.flatMap(x => x.status === 'fulfilled' ? x.value : []);
    const newIds = [];
    for (const job of candidates) { const id = saveJob(job); if (id) newIds.push(id); }
    const fresh = unalerted(newIds);
    const telegram = await sendTelegram(fresh);
    if (telegram.sent) markAlerted(fresh.map(x => x.id));
    const issues = outcomes.filter(x => x.status === 'rejected').map(x => x.reason.message).join('; ');
    finishScan(scanId, issues ? 'partial' : 'complete', fresh.length, issues || null);
    return { newMatches: fresh.length, candidates: candidates.length, telegram, issues: issues || null };
  } catch (error) {
    finishScan(scanId, 'failed', 0, error.message);
    throw error;
  } finally { scanning = false; }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, scanning, configured: { serpApi: Boolean(process.env.SERPAPI_KEY), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) } }));
app.get('/api/jobs', (req, res) => res.json(jobs(req.query)));
app.get('/api/dashboard', (_req, res) => res.json({ stats: stats(), latestScan: latestScan(), scanning }));
app.post('/api/scan', async (_req, res) => { try { res.json(await scan()); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/test-alert', async (_req, res) => { try { res.json(await sendTelegram([{ title: 'Job Hunter test alert', company: 'Configuration check', location: 'Bangalore', tag: 'Direct', url: 'https://example.com' }])); } catch (error) { res.status(500).json({ error: error.message }); } });
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT || 8787);
if (process.argv.includes('--scan')) scan().then(result => { console.log(JSON.stringify(result)); process.exit(0); }).catch(error => { console.error(error); process.exit(1); });
else {
  app.listen(port, () => console.log(`Job Hunter API running on ${port}`));
  const minutes = Math.max(5, Number(process.env.SCAN_INTERVAL_MINUTES || 60));
  cron.schedule(`*/${minutes} * * * *`, scan, { timezone: 'Asia/Kolkata' });
}
