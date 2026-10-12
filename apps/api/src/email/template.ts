/** Structured email content: rendered to branded HTML and to a matching plain-text version. */
export interface EmailContent {
  subject: string;
  /** Inbox preview line (hidden in the message). Defaults to the intro. */
  preheader?: string;
  heading: string;
  /** Paragraphs separated by blank lines. */
  intro: string;
  /** Key facts as a two-column table (Item, Space, Access, Shared by…). */
  details?: { label: string; value: string }[];
  /** Lists of linked items, e.g. the pages in a review digest. */
  sections?: { title: string; items: { title: string; meta?: string; url?: string }[]; more?: number }[];
  action?: { label: string; url: string };
  /** Small print under the button. */
  note?: string;
  /** Footer: why this person got the email. */
  reason?: string;
}

export interface RenderContext {
  /** Public address of Trigon, for the footer and the preferences link. */
  appUrl: string;
  /** Image source of the logo: `cid:…` when sending, a data: URL for previews. */
  logoSrc: string;
}

const COLORS = {
  navy: '#0b1430',
  navyInk: '#8193c2',
  accent: '#2f6cf2',
  page: '#eef1f7',
  card: '#ffffff',
  ink: '#151b2e',
  ink2: '#4a5270',
  ink3: '#7d849e',
  line: '#e6e9f2',
  soft: '#f6f8fc',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const paragraphs = (text: string, style: string) =>
  text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 14px;${style}">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

export function renderEmailHtml(c: EmailContent, ctx: RenderContext): string {
  const host = ctx.appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const details = c.details?.length
    ? `<tr><td style="padding:4px 0 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.soft};border:1px solid ${COLORS.line};border-radius:12px">
${c.details
  .map(
    (d, i) => `<tr>
<td style="padding:11px 16px;${i ? `border-top:1px solid ${COLORS.line};` : ''}font:600 12px ${FONT};color:${COLORS.ink3};text-transform:uppercase;letter-spacing:.04em;width:34%;vertical-align:top">${esc(d.label)}</td>
<td style="padding:11px 16px;${i ? `border-top:1px solid ${COLORS.line};` : ''}font:500 14px ${FONT};color:${COLORS.ink};vertical-align:top">${esc(d.value)}</td>
</tr>`,
  )
  .join('')}
</table></td></tr>`
    : '';
  const sections = (c.sections ?? [])
    .map(
      (s) => `<tr><td style="padding:6px 0 4px;font:700 13px ${FONT};color:${COLORS.ink2};text-transform:uppercase;letter-spacing:.05em">${esc(s.title)}</td></tr>
<tr><td style="padding:0 0 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.line};border-radius:12px">
${s.items
  .map(
    (it, i) => `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${COLORS.line};` : ''}">
${it.url ? `<a href="${esc(it.url)}" style="font:600 15px ${FONT};color:${COLORS.accent};text-decoration:none">${esc(it.title)}</a>` : `<span style="font:600 15px ${FONT};color:${COLORS.ink}">${esc(it.title)}</span>`}
${it.meta ? `<div style="font:13px ${FONT};color:${COLORS.ink3};padding-top:2px">${esc(it.meta)}</div>` : ''}
</td></tr>`,
  )
  .join('')}
${s.more ? `<tr><td style="padding:10px 16px;border-top:1px solid ${COLORS.line};font:13px ${FONT};color:${COLORS.ink3}">…and ${s.more} more</td></tr>` : ''}
</table></td></tr>`,
    )
    .join('');
  const button = c.action
    ? `<tr><td style="padding:6px 0 8px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${COLORS.accent}" style="border-radius:999px">
<a href="${esc(c.action.url)}" style="display:inline-block;padding:13px 26px;font:600 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${esc(c.action.label)}</a>
</td></tr></table></td></tr>`
    : '';
  const note = c.note ? `<tr><td style="padding:10px 0 0;font:13px/1.5 ${FONT};color:${COLORS.ink3}">${esc(c.note)}</td></tr>` : '';
  const preheader = esc(c.preheader ?? c.intro.split('\n')[0]);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:${COLORS.navy};border-radius:16px 16px 0 0;padding:20px 32px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="${esc(ctx.logoSrc)}" width="36" height="36" alt="" style="display:block;border:0"></td>
<td style="vertical-align:middle;padding-left:12px">
<div style="font:700 17px ${FONT};letter-spacing:.14em;color:#ffffff">TRIGON</div>
<div style="font:600 9px ${FONT};letter-spacing:.22em;color:${COLORS.navyInk};padding-top:3px">COLLABORATIVE WORKSPACE</div>
</td></tr></table>
</td></tr>
<tr><td style="background:${COLORS.card};border-radius:0 0 16px 16px;padding:32px 32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:700 22px/1.3 ${FONT};color:${COLORS.ink};padding-bottom:14px">${esc(c.heading)}</td></tr>
<tr><td style="font:15px/1.6 ${FONT};color:${COLORS.ink2}">${paragraphs(c.intro, '')}</td></tr>
${details}${sections}${button}${note}
</table>
</td></tr>
<tr><td style="padding:22px 32px 0;font:12px/1.6 ${FONT};color:${COLORS.ink3};text-align:center">
${c.reason ? `${esc(c.reason)} <a href="${esc(ctx.appUrl)}/profile" style="color:${COLORS.ink3};text-decoration:underline">Manage email notifications</a><br>` : ''}
Trigon · <a href="${esc(ctx.appUrl)}" style="color:${COLORS.ink3};text-decoration:underline">${esc(host)}</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function renderEmailText(c: EmailContent, ctx: Pick<RenderContext, 'appUrl'>): string {
  const out = [c.heading, '', c.intro.trim()];
  if (c.details?.length) {
    const width = Math.max(...c.details.map((d) => d.label.length));
    out.push('', ...c.details.map((d) => `${`${d.label}:`.padEnd(width + 2)}${d.value}`));
  }
  for (const s of c.sections ?? []) {
    out.push('', `${s.title.toUpperCase()}`);
    for (const it of s.items) out.push(`• ${it.title}${it.meta ? ` (${it.meta})` : ''}`, ...(it.url ? [`  ${it.url}`] : []));
    if (s.more) out.push(`…and ${s.more} more`);
  }
  if (c.action) out.push('', `${c.action.label}: ${c.action.url}`);
  if (c.note) out.push('', c.note);
  out.push('', '—', ...(c.reason ? [`${c.reason} Manage email notifications: ${ctx.appUrl}/profile`] : []), `Trigon · ${ctx.appUrl}`);
  return out.join('\n');
}
