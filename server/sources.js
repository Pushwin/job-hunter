import crypto from 'node:crypto';
import fs from 'node:fs';

// \b cannot be used around ".net" / "c#" because "." and "#" are not word
// characters, so explicit non-alphanumeric boundaries are used instead.
const roles = /(?:^|[^a-z0-9])(\.net|dot\s?net|asp\.net|c#|java|technical consultant|software engineer|software developer|systems engineer|software trainee|graduate engineer|trainee engineer)(?![a-z0-9])/i;
const entryLevel = /\b(fresher|freshers|graduate|trainee|entry.?level|junior|associate|new college graduate|ncg|campus|walk[\s-]?in|0\s*(?:-|–|to)\s*1\s*(?:years?|yrs?))\b/i;
const seniorTitle = /\b(senior|sr\.?|lead|principal|staff|manager|director|architect|head|vp|smts|lmts)\b/i;
const cities = /\b(bangalore|bengaluru|mangalore|mangaluru|mysore|mysuru)\b/i;
const blocked = (process.env.BLOCKLIST || 'tcs,infosys,wipro,accenture,cognizant,capgemini,ibm,deloitte').split(',').map(x => x.trim().toLowerCase());
const ageHours = Number(process.env.JOB_MAX_AGE_HOURS || 24);
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');
const hoursAgo = value => (Date.now() - new Date(value).getTime()) / 36e5;
const plain = html => String(html || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function postedTime(value) {
  if (!value) return null;
  const text = String(value);
  // "Today" / "Posted Today" is always inside the last 24 hours.
  if (/\b(today|just posted|recently posted)\b/i.test(text)) return new Date().toISOString();
  // "Yesterday" / "1 day ago" is at least 24 hours old, so it lands outside the window.
  if (/\byesterday\b/i.test(text)) return new Date(Date.now() - 36 * 36e5).toISOString();
  const relative = text.match(/(\d+)\+?\s*(minute|min|hour|hr|day|week|month)/i);
  if (relative) {
    const hours = { minute: 1 / 60, min: 1 / 60, hour: 1, hr: 1, day: 24, week: 168, month: 720 }[relative[2].toLowerCase()];
    return new Date(Date.now() - Number(relative[1]) * hours * 36e5).toISOString();
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Only year counts that sit next to the word "experience" are treated as a
// requirement, so "130 years of history" does not reject a fresher role.
function zeroExperienceOnly(text) {
  for (const m of text.matchAll(/(\d+)\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d+)\s*)?\+?\s*(?:years?|yrs?)/gi)) {
    const context = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (!/experience|\bexp\b/i.test(context)) continue;
    const low = Number(m[1]);
    const high = m[2] ? Number(m[2]) : low;
    if (low > 0 || high > 1) return false;
  }
  return true;
}

function rejection(job) {
  const text = `${job.title} ${job.description}`;
  if (!job.postedAt) return 'no exact date';
  if (hoursAgo(job.postedAt) >= ageHours) return 'older than 24h';
  if (!cities.test(job.location || text)) return 'other city';
  if (!roles.test(text)) return 'other role';
  if (seniorTitle.test(job.title)) return 'senior title';
  if (!entryLevel.test(text)) return 'not entry-level';
  if (!zeroExperienceOnly(text)) return 'needs experience';
  if (blocked.some(name => (job.company || '').toLowerCase().includes(name))) return 'blocklisted company';
  return null;
}

function isoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function tally(source) { return { source, inspected: 0, rejected: {}, jobs: [], errors: [] }; }
function consider(t, raw, source, tag) {
  t.inspected += 1;
  const job = { title: plain(raw.title) || 'Untitled role', company: raw.company || '', location: plain(raw.location), url: (raw.url || '').trim(), description: plain(raw.description), postedAt: isoDate(raw.postedAt), source, tag };
  const reason = job.url ? rejection(job) : 'no link';
  if (reason) { t.rejected[reason] = (t.rejected[reason] || 0) + 1; return; }
  job.fingerprint = fingerprint(`${job.url.toLowerCase()}|${job.title.toLowerCase()}`);
  t.jobs.push(job);
}

async function serp(params) {
  const url = new URL('https://serpapi.com/search.json');
  Object.entries({ api_key: process.env.SERPAPI_KEY, ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  // SerpAPI reports "no results" as an error string with HTTP 200; that is an
  // empty result, not a failure.
  if (!response.ok || (data.error && !/hasn't returned any results/i.test(data.error))) throw new Error(`SerpAPI ${response.status}${data.error ? `: ${data.error}` : ''}`);
  return data;
}

export async function googleJobs() {
  const t = tally('Google Jobs');
  if (!process.env.SERPAPI_KEY) { t.errors.push('SERPAPI_KEY not set'); return t; }
  const roleQueries = [
    '(.NET OR C#) (fresher OR graduate OR trainee)',
    '(Java OR "Associate Technical Consultant") (fresher OR graduate OR trainee)',
    '("Software Engineer" OR "Software Developer") fresher (Java OR .NET OR C#)',
    '(fresher OR trainee) (walk-in OR walkin) (Java OR .NET OR C#)'
  ];
  // Exact SerpAPI canonical names: plain "Bangalore"/"Mysore" resolve to
  // "Ullal, Bangalore Division" etc., which targets the wrong area.
  for (const city of ['Bengaluru,Karnataka,India', 'Mangaluru,Karnataka,India', 'Mysuru,Karnataka,India']) {
    for (const query of roleQueries) {
      // One failing query must not discard the results of the others.
      try {
        const data = await serp({ engine: 'google_jobs', q: query, location: city, hl: 'en', gl: 'in' });
        for (const item of data.jobs_results || []) {
          consider(t, { title: item.title, company: item.company_name, location: item.location, url: item.apply_options?.[0]?.link || item.share_link, description: item.description, postedAt: postedTime(item.detected_extensions?.posted_at || item.extensions?.find(e => /ago|today|yesterday|posted/i.test(e))) }, 'SerpAPI Google Jobs', 'Direct');
        }
      } catch (error) { t.errors.push(`${city.split(',')[0]} "${query}": ${error.message}`); }
    }
  }
  return t;
}

export async function googleForms() {
  const t = tally('Google Forms');
  if (!process.env.SERPAPI_KEY) { t.errors.push('SERPAPI_KEY not set'); return t; }
  try {
    const data = await serp({ engine: 'google', q: 'site:docs.google.com/forms OR site:forms.gle (fresher OR trainee) apply (Java OR .NET OR C#) (Bangalore OR Bengaluru)', tbs: 'qdr:d', hl: 'en', gl: 'in' });
    for (const x of data.organic_results || []) consider(t, { title: x.title, url: x.link, description: x.snippet, location: `${x.title} ${x.snippet}`, postedAt: postedTime(x.date) }, 'SerpAPI Google search', 'Google Form');
  } catch (error) { t.errors.push(error.message); }
  return t;
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

async function atsJobs(company, t) {
  if (company.board === 'greenhouse') {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs?content=true`);
    // first_published is the real posting date; updated_at changes on any edit.
    for (const x of data.jobs) consider(t, { title: x.title, company: company.name, location: x.location?.name, url: x.absolute_url, description: x.content, postedAt: x.first_published }, 'Greenhouse board', 'Direct');
  } else if (company.board === 'lever') {
    const data = await getJson(`https://api.lever.co/v0/postings/${company.token}?mode=json`);
    for (const x of data) consider(t, { title: x.text, company: company.name, location: x.categories?.location, url: x.hostedUrl, description: x.descriptionPlain, postedAt: x.createdAt }, 'Lever board', 'Direct');
  } else if (company.board === 'ashby') {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${company.token}?includeCompensation=false`);
    for (const x of data.jobs) consider(t, { title: x.title, company: company.name, location: x.location, url: x.jobUrl, description: x.descriptionPlain, postedAt: x.publishedAt }, 'Ashby board', 'Direct');
  } else if (company.board === 'smartrecruiters') {
    const base = `https://api.smartrecruiters.com/v1/companies/${company.token}/postings`;
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await getJson(`${base}?country=in&limit=100&offset=${offset}`);
      for (const x of page.content || []) {
        const city = x.location?.city || '';
        // Details are only fetched for fresh local postings to keep scans fast.
        if (!cities.test(city) || hoursAgo(x.releasedDate) > ageHours) { consider(t, { title: x.name, company: company.name, location: city, url: `https://jobs.smartrecruiters.com/${company.token}/${x.id}`, postedAt: x.releasedDate }, 'SmartRecruiters', 'Direct'); continue; }
        const detail = await getJson(`${base}/${x.id}`);
        const description = Object.values(detail.jobAd?.sections || {}).map(s => s.text).join(' ');
        consider(t, { title: x.name, company: company.name, location: city, url: detail.postingUrl || `https://jobs.smartrecruiters.com/${company.token}/${x.id}`, description, postedAt: x.releasedDate }, 'SmartRecruiters', 'Direct');
      }
      if (offset + 100 >= (page.totalFound || 0)) break;
    }
  } else if (company.board === 'workday') {
    const base = `https://${company.tenant}.${company.host}.myworkdayjobs.com/wday/cxs/${company.tenant}/${company.site}`;
    // Workday's listing order is relevance-based, not strictly by date, so
    // every page of the city search is read rather than stopping early.
    const todays = new Map();
    const seen = new Set();
    for (const searchText of ['Bangalore', 'Bengaluru', 'Mysore', 'Mangalore']) {
      for (let offset = 0; offset < 1000; offset += 20) {
        const page = await getJson(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }) });
        const postings = page.jobPostings || [];
        for (const p of postings) {
          if (seen.has(p.externalPath)) continue;
          seen.add(p.externalPath);
          if (/today/i.test(p.postedOn || '')) todays.set(p.externalPath, p);
          else consider(t, { title: p.title, company: company.name, location: p.locationsText, url: `${base}${p.externalPath}`, postedAt: postedTime(p.postedOn) }, 'Workday', 'Direct');
        }
        if (postings.length < 20 || offset + 20 >= (page.total || 0)) break;
      }
    }
    for (const p of todays.values()) {
      const info = (await getJson(`${base}${p.externalPath}`)).jobPostingInfo || {};
      consider(t, { title: info.title || p.title, company: company.name, location: [info.location, ...(info.additionalLocations || [])].join('; '), url: info.externalUrl, description: info.jobDescription, postedAt: postedTime(info.postedOn || p.postedOn) }, 'Workday', 'Direct');
    }
  }
}

export async function companyBoards() {
  const t = tally('Company careers');
  const companies = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const results = await Promise.allSettled(companies.map(company => atsJobs(company, t)));
  results.forEach((r, i) => { if (r.status === 'rejected') t.errors.push(`${companies[i].name}: ${r.reason.message}`); });
  return t;
}

// Walk-ins come from public fresher-job RSS feeds. Telegram has no public
// cross-channel search API, so no Telegram scraping is involved here.
const defaultFeeds = ['https://www.freshersnow.com/category/walkin/feed/', 'https://www.freshersnow.com/feed/'];
export async function walkIns() {
  const t = tally('Walk-ins');
  const feeds = (process.env.WALKIN_RSS_FEEDS || defaultFeeds.join(',')).split(',').map(x => x.trim()).filter(Boolean);
  const pick = (block, tag) => {
    const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
    return match ? match[1].trim() : '';
  };
  await Promise.allSettled(feeds.map(async feed => {
    try {
      const response = await fetch(feed);
      if (!response.ok) throw new Error(`${response.status}`);
      const xml = await response.text();
      for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const title = pick(block, 'title');
        const description = pick(block, 'description');
        consider(t, { title, url: pick(block, 'link'), description, location: `${title} ${description}`, postedAt: pick(block, 'pubDate') }, 'Public walk-in RSS feed', 'Walk-in');
      }
    } catch (error) { t.errors.push(`${new URL(feed).hostname}: ${error.message}`); }
  }));
  // FreshersNow blocks Render's datacenter IPs, so Google search is the reliable walk-in source.
  if (process.env.SERPAPI_KEY) {
    try {
      const data = await serp({ engine: 'google', q: '("walk-in" OR walkin OR "walk in drive") (fresher OR freshers) (Java OR .NET OR "C#") (Bangalore OR Bengaluru OR Mysore OR Mangalore)', tbs: 'qdr:d', hl: 'en', gl: 'in' });
      for (const x of data.organic_results || []) consider(t, { title: x.title, url: x.link, description: x.snippet, location: `${x.title} ${x.snippet}`, postedAt: postedTime(x.date) }, 'SerpAPI Google search', 'Walk-in');
    } catch (error) { t.errors.push(`Google search: ${error.message}`); }
  }
  // The walk-in category is also in the main feed; keep one copy of each post.
  const seen = new Set();
  t.jobs = t.jobs.filter(job => !seen.has(job.fingerprint) && seen.add(job.fingerprint));
  return t;
}
