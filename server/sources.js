import crypto from 'node:crypto';
import fs from 'node:fs';

const roles = /\b(\.net|c#|java|technical consultant|software engineer|software developer|systems engineer|software trainee|graduate engineer|trainee engineer)\b/i;
const entryLevel = /\b(fresher|graduate|trainee|entry.?level|junior|associate|new college graduate|ncg|campus|walk[\s-]?in|0\s*(?:-|–|to)\s*1\s*(?:years?|yrs?))\b/i;
const cities = /\b(bangalore|bengaluru|mangalore|mangaluru|mysore|mysuru)\b/i;
const blocked = (process.env.BLOCKLIST || 'tcs,infosys,wipro,accenture,cognizant,capgemini,ibm,deloitte').split(',').map(x => x.trim().toLowerCase());
const ageHours = Number(process.env.JOB_MAX_AGE_HOURS || 24);
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');
const hoursAgo = value => value ? (Date.now() - new Date(value).getTime()) / 36e5 : 0;
function postedTime(value) {
  if (!value) return null;
  // Google Jobs commonly says “Today” or “Just posted”. Those are safely
  // within the current calendar day, so they are valid for a 24-hour search.
  if (/\b(today|just posted|recently posted)\b/i.test(String(value))) return new Date().toISOString();
  const relative = String(value).match(/(\d+)\s*(minute|min|hour|hr|day|week)/i);
  if (relative) {
    // “1 day ago” has no precise time and could be almost 48 hours old.
    // Do not guess it is inside the requested exact 24-hour window.
    if (/day|week/i.test(relative[2])) return null;
    const factor = /minute|min/i.test(relative[2]) ? 1 / 60 : 1;
    return new Date(Date.now() - Number(relative[1]) * factor * 36e5).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function acceptable(job) {
  const text = `${job.title} ${job.description || ''}`;
  const company = (job.company || '').toLowerCase();
  // An exact “last 24 hours” promise requires a real timestamp. Search results
  // without one are deliberately skipped instead of being guessed as fresh.
  return Boolean(job.postedAt) && roles.test(text) && entryLevel.test(text) && zeroExperienceOnly(text) && cities.test(job.location || text) && !blocked.some(name => company.includes(name)) && hoursAgo(job.postedAt) <= ageHours;
}
function zeroExperienceOnly(text) {
  // Reject a clear experience requirement above zero, such as “2–4 years”
  // or “1+ year”. Listings that omit experience remain eligible if entry-level.
  const range = text.match(/\b(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:years?|yrs?)\b/i);
  if (range) return Number(range[1]) === 0 && Number(range[2]) <= 1;
  const single = text.match(/\b(\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
  return !single || Number(single[1]) === 0;
}
function normalize(raw, source, tag) {
  const job = { title: raw.title || 'Untitled role', company: raw.company || raw.company_name || '', location: raw.location || raw.location_name || '', url: raw.url || raw.apply_url || raw.share_link || '', description: raw.description || '', postedAt: raw.postedAt || raw.posted_at || null, source, tag };
  if (!job.url) return null;
  job.fingerprint = fingerprint(`${job.url.toLowerCase()}|${job.title.toLowerCase()}`);
  return acceptable(job) ? job : null;
}
async function serp(params) {
  if (!process.env.SERPAPI_KEY) return [];
  const url = new URL('https://serpapi.com/search.json');
  Object.entries({ api_key: process.env.SERPAPI_KEY, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);
  return response.json();
}
export async function googleJobs() {
  const found = [];
  let inspected = 0;
  const roleQueries = [
    '(.NET OR C#) (fresher OR graduate OR trainee)',
    '(Java OR "Associate Technical Consultant") (fresher OR graduate OR trainee)',
    '("Software Engineer" OR "Software Developer") fresher (Java OR .NET OR C#)',
    '(fresher OR trainee) (walk-in OR walkin) (Java OR .NET OR C#)'
  ];
  for (const city of ['Bangalore', 'Mangalore', 'Mysore']) {
    for (const query of roleQueries) {
      const data = await serp({ engine: 'google_jobs', q: query, location: city, hl: 'en', gl: 'in' });
      for (const item of data.jobs_results || []) {
        inspected += 1;
        const apply = item.apply_options?.[0]?.link || item.share_link;
        const match = normalize({ title: item.title, company: item.company_name, location: item.location, url: apply, description: item.description, postedAt: postedTime(item.detected_extensions?.posted_at) }, 'SerpAPI Google Jobs', 'Direct');
        if (match) found.push(match);
      }
    }
  }
  return { source: 'Google Jobs', inspected, jobs: found };
}
export async function googleForms() {
  const data = await serp({ engine: 'google', q: 'site:docs.google.com/forms OR site:forms.gle (fresher OR trainee) apply (Java OR .NET OR C#) (Bangalore OR Bengaluru)', tbs: 'qdr:d', hl: 'en', gl: 'in' });
  const results = data.organic_results || [];
  return { source: 'Google Forms', inspected: results.length, jobs: results.map(x => normalize({ title: x.title, url: x.link, description: x.snippet, location: x.snippet, postedAt: postedTime(x.date) }, 'SerpAPI Google search', 'Google Form')).filter(Boolean) };
}
async function boardJobs(company) {
  const endpoints = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${company.token}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${company.token}?includeCompensation=false`
  };
  const res = await fetch(endpoints[company.board]);
  if (!res.ok) throw new Error(`${company.name}: ${res.status}`);
  const data = await res.json();
  const list = data.jobs || data;
  return list.map(x => normalize({ title: x.title, company: company.name, location: x.location?.name || x.categories?.location || x.location, url: x.absolute_url || x.hostedUrl || x.applyUrl, description: x.content || x.descriptionPlain || x.description, postedAt: x.updated_at || x.createdAt || x.publishedAt }, `${company.board} board`, 'Direct')).filter(Boolean);
}
export async function companyBoards() {
  const companies = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const configured = companies.filter(x => x.token && x.token !== 'example');
  const results = await Promise.allSettled(configured.map(boardJobs));
  const jobs = results.flatMap(x => x.status === 'fulfilled' ? x.value : []);
  return { source: 'Company boards', inspected: configured.length, jobs };
}
// Walk-ins come from public fresher-job RSS feeds. Telegram has no public
// cross-channel search API, so no Telegram scraping is involved here.
const defaultFeeds = ['https://www.freshersnow.com/category/walkin/feed/', 'https://www.freshersnow.com/feed/'];
export async function walkIns() {
  const feeds = (process.env.WALKIN_RSS_FEEDS || defaultFeeds.join(',')).split(',').map(x => x.trim()).filter(Boolean);
  const results = await Promise.allSettled(feeds.map(async feed => {
    const response = await fetch(feed);
    if (!response.ok) throw new Error(`Walk-in feed returned ${response.status}`);
    const xml = await response.text();
    const pick = (block, tag) => {
      const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return match ? match[1].trim() : '';
    };
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(x => x[1])
      .map(block => normalize({ title: pick(block, 'title'), url: pick(block, 'link'), description: pick(block, 'description'), location: `${pick(block, 'title')} ${pick(block, 'description')}`, postedAt: pick(block, 'pubDate') }, 'Public walk-in RSS feed', 'Walk-in')).filter(Boolean);
  }));
  return { source: 'Walk-ins', inspected: feeds.length, jobs: results.flatMap(x => x.status === 'fulfilled' ? x.value : []) };
}
