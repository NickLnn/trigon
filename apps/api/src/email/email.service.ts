import { Injectable, Logger } from '@nestjs/common';
import type { EmailMicrosoftStatus, EmailSettings } from '@trigon/shared';
import { createTransport } from 'nodemailer';
import { EntraClientService, GRAPH } from '../directory/entra-client.service';
import { SettingsService } from '../settings/settings.service';

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  /** Plain-text body; also used to build the HTML version when `html` is omitted. */
  text: string;
  html?: string;
  /** A button under the text (and a link line in the plain-text version). */
  action?: { label: string; url: string };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal, mail-client-safe HTML around a plain-text message. URLs in the text become links. */
export function emailHtml(subject: string, text: string, appUrl: string, action?: OutgoingEmail['action']) {
  const linkify = (s: string) => s.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#3b5bdb">${u}</a>`);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(escape(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = action
    ? `<tr><td style="padding:6px 0 18px"><a href="${escape(action.url)}" style="display:inline-block;background:#3b5bdb;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:999px">${escape(action.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">${escape(subject)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55">${paragraphs}</td></tr>
${button}
<tr><td style="padding-top:12px;font-size:12px;color:#7a8099">Sent by Trigon · <a href="${escape(appUrl)}" style="color:#7a8099">${escape(appUrl)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** Roles in an app-only token (JWT payload), e.g. ['User.Read.All', 'Mail.Send']. */
export function tokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { roles?: string[] };
    return payload.roles ?? [];
  } catch {
    return [];
  }
}

/**
 * Sends email through the method chosen in Settings → Email: an SMTP server, or Microsoft 365 via
 * Graph (the Entra app registration with the Mail.Send permission).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly entra: EntraClientService,
  ) {}

  async enabled() {
    const s = await this.settings.get('email');
    return s.provider !== 'none' && !!s.fromAddress;
  }

  /** Send with the saved settings. Throws when email is off or the provider rejects the message. */
  async send(mail: OutgoingEmail): Promise<void> {
    const s = await this.settings.get('email');
    if (s.provider === 'none' || !s.fromAddress) throw new Error('Email is not set up (Settings → Email)');
    await this.deliver(s, mail);
  }

  /** Fire-and-forget variant for notifications: failures are logged, never thrown. */
  notify(mail: OutgoingEmail): void {
    this.enabled()
      .then(async (on) => {
        if (on) await this.send(mail);
      })
      .catch((err: Error) => this.logger.error(`Email "${mail.subject}" failed: ${err.message}`));
  }

  /** "Send test email" with the settings on screen; an empty password field means "use the stored one". */
  async test(form: EmailSettings, to: string): Promise<{ ok: boolean; message: string }> {
    if (form.provider === 'none') return { ok: false, message: 'Choose how Trigon sends email first.' };
    const stored = await this.settings.get('email');
    const s: EmailSettings = { ...form, smtpPassword: form.smtpPassword || stored.smtpPassword };
    try {
      await this.deliver(s, {
        to,
        subject: 'Trigon test email',
        text: `This is a test message from Trigon.\n\nIf you can read this, email is working (${s.provider === 'smtp' ? `SMTP via ${s.smtpHost}` : 'Microsoft 365 / Exchange Online'}).`,
      });
      return { ok: true, message: `Test email sent to ${to}. Check the inbox (and the junk folder).` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private async deliver(s: EmailSettings, mail: OutgoingEmail) {
    const to = Array.isArray(mail.to) ? mail.to : [mail.to];
    const html = mail.html ?? emailHtml(mail.subject, mail.text, await this.settings.publicUrl(), mail.action);
    const text = mail.action ? `${mail.text}\n\n${mail.action.label}: ${mail.action.url}` : mail.text;
    if (s.provider === 'smtp') return this.viaSmtp(s, to, mail.subject, text, html);
    return this.viaGraph(s, to, mail.subject, html);
  }

  private async viaSmtp(s: EmailSettings, to: string[], subject: string, text: string, html: string) {
    if (!s.smtpHost) throw new Error('Enter the SMTP server address.');
    const transport = createTransport({
      host: s.smtpHost,
      port: s.smtpPort,
      secure: s.smtpSecurity === 'tls',
      requireTLS: s.smtpSecurity === 'starttls',
      ignoreTLS: s.smtpSecurity === 'none',
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword ?? '' } : undefined,
      tls: { rejectUnauthorized: s.smtpTlsRejectUnauthorized },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      await transport.sendMail({ from: { name: s.fromName || 'Trigon', address: s.fromAddress }, to, subject, text, html });
    } catch (err) {
      throw new Error(`SMTP: ${(err as Error).message}`);
    } finally {
      transport.close();
    }
  }

  private async viaGraph(s: EmailSettings, to: string[], subject: string, html: string) {
    if (!(await this.entra.enabled())) throw new Error('Microsoft Entra ID is not connected (Settings → Microsoft Entra ID).');
    const token = await EntraClientService.appToken(await this.entra.client());
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(s.fromAddress)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return;
    const body = await res.text();
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
    } catch {
      /* not JSON */
    }
    if (res.status === 403) {
      throw new Error(
        `Microsoft refused to send as ${s.fromAddress}: ${message} — Trigon needs the Mail.Send permission (Settings → Email → Allow Trigon to send email), and an Exchange application access policy, if you use one, must include this mailbox.`,
      );
    }
    if (res.status === 404) throw new Error(`Microsoft 365 has no mailbox ${s.fromAddress}. Use a licensed user or a shared mailbox in your tenant.`);
    throw new Error(`Microsoft Graph ${res.status}: ${message}`);
  }

  /** Whether the connected app registration holds Mail.Send (read from a fresh app token's roles). */
  async microsoftStatus(): Promise<EmailMicrosoftStatus> {
    if (!(await this.entra.enabled())) {
      return { connected: false, mailSend: 'unknown', message: 'Connect Trigon to Microsoft Entra ID first.' };
    }
    try {
      const client = await this.entra.client();
      const result = await client.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'], skipCache: true });
      const granted = tokenRoles(result?.accessToken ?? '').includes('Mail.Send');
      return {
        connected: true,
        mailSend: granted ? 'granted' : 'missing',
        message: granted ? null : 'The Trigon app registration does not have permission to send mail yet.',
      };
    } catch (err) {
      return { connected: true, mailSend: 'unknown', message: (err as Error).message };
    }
  }
}
