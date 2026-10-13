import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';
const relative = value => value ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((new Date(value) - Date.now()) / 36e5), 'hour') : 'just now';
function App() {
  const [jobs, setJobs] = useState([]); const [info, setInfo] = useState({}); const [tag, setTag] = useState('All'); const [search, setSearch] = useState(''); const [working, setWorking] = useState(false); const [toast, setToast] = useState('');
  async function load() { const [j, d] = await Promise.all([fetch(`${API}/jobs?tag=${tag}&search=${encodeURIComponent(search)}`).then(x => x.json()), fetch(`${API}/dashboard`).then(x => x.json())]); setJobs(j); setInfo(d); }
  useEffect(() => { load().catch(() => setToast('Could not reach the backend. Is it running?')); }, [tag, search]);
  async function scan() { setWorking(true); try { const r = await fetch(`${API}/scan`, { method: 'POST' }).then(x => x.json()); setToast(r.error || (r.skipped ? r.reason : `Scan complete: ${r.newMatches} new matches.`)); await load(); } finally { setWorking(false); } }
  async function testAlert() { const r = await fetch(`${API}/test-alert`, { method: 'POST' }).then(x => x.json()); setToast(r.error || (r.sent ? 'Test alert sent to Telegram.' : r.reason)); }
  const counts = useMemo(() => info.stats || {}, [info]);
  return <main><header><div><span className="eyebrow">PRIVATE JOB RADAR</span><h1>Job Hunter</h1><p>Fresh early-career tech roles, found without logging into your accounts.</p></div><div className="actions"><button className="quiet" onClick={testAlert}>Test Telegram</button><button className="primary" disabled={working} onClick={scan}>{working ? 'Scanning…' : 'Search now'}</button></div></header>
  {toast && <div className="toast" onClick={() => setToast('')}>{toast} <span>×</span></div>}
  <section className="metrics"><Metric label="All matches" value={counts.total || 0}/><Metric label="Google Forms" value={counts.forms || 0}/><Metric label="Walk-ins" value={counts.walkins || 0}/><Metric label="Direct careers" value={counts.direct || 0}/></section>
  <section className="status"><span className={info.scanning ? 'pulse' : 'dot'}></span>{info.scanning ? 'Searching sources now' : info.latestScan ? `Last scan ${relative(info.latestScan.finished_at || info.latestScan.started_at)} · ${info.latestScan.found_count} new matches` : 'Ready for your first search'}<span className="spacer"/>Alerts: {counts.alerted || 0}</section>
  <section className="toolbar"><div className="tabs">{['All', 'Google Form', 'Walk-in', 'Direct'].map(x => <button key={x} className={tag === x ? 'active' : ''} onClick={() => setTag(x)}>{x}</button>)}</div><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, company, location"/></section>
  <section className="jobs">{jobs.length ? jobs.map(job => <article className="job" key={job.id}><div className="job-main"><span className={`badge ${job.tag.toLowerCase().replace(' ', '-')}`}>{job.tag}</span><h2>{job.title}</h2><p>{job.company || 'Company not listed'} <i>•</i> {job.location || 'Location not listed'}</p><small>Found {relative(job.discovered_at)} · {job.source}</small></div><a href={job.url} target="_blank" rel="noreferrer">Apply privately ↗</a></article>) : <div className="empty"><h2>No matches yet</h2><p>Add your SerpAPI and Telegram keys to <code>.env</code>, then use Search now. Only public listings are scanned.</p></div>}</section>
  <footer>Does not sign in to LinkedIn, Indeed, email, or any third-party site. Open application links in a private window.</footer></main>
}
function Metric({ label, value }) { return <div className="metric"><strong>{value}</strong><span>{label}</span></div> }
createRoot(document.getElementById('root')).render(<App/>);
