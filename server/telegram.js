export async function sendTelegram(jobs) {
  if (!jobs.length || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return { sent: false, reason: 'Telegram credentials are not configured' };
  const lines = jobs.slice(0, 15).map((job, i) => `${i + 1}. <b>${escape(job.title)}</b> — ${escape(job.company || 'Company not listed')}\n${escape(job.location || 'Location not listed')} · ${job.tag}\n<a href="${job.url}">Open application</a>`);
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `🎯 <b>Job Hunter: ${jobs.length} new match${jobs.length === 1 ? '' : 'es'}</b>\n\n${lines.join('\n\n')}`, parse_mode: 'HTML', disable_web_page_preview: true }) });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  return { sent: true };
}
const escape = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
