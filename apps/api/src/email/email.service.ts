import { Injectable, Logger } from '@nestjs/common';
import type { EmailMicrosoftStatus, EmailSettings } from '@trigon/shared';
import { createTransport } from 'nodemailer';
import { EntraClientService, GRAPH } from '../directory/entra-client.service';
import { storedSecretFor } from '../settings/secret-box';
import { SettingsService } from '../settings/settings.service';
import { testEmail } from '../notifications/messages';
import { LOGO_PNG_BASE64 } from './logo';
import { renderEmailHtml, renderEmailText, type EmailContent } from './template';

/** A notification or test message: structured content (see template.ts) plus its recipients. */
export type OutgoingEmail = EmailContent & { to: string | string[] };

const LOGO_CID = 'trigon-logo';

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

  /**
   * "Send test email" with the settings on screen. An empty password field means "use the stored one",
   * but only for the saved server and user — never to send the stored password somewhere else.
   */
  async test(form: EmailSettings, to: string): Promise<{ ok: boolean; message: string }> {
    if (form.provider === 'none') return { ok: false, message: 'Choose how Trigon sends email first.' };
    const stored = await this.settings.get('email');
    const smtpPassword =
      form.provider === 'smtp'
        ? storedSecretFor(form, stored, 'smtpPassword', ['smtpHost', 'smtpPort', 'smtpSecurity', 'smtpUser', 'smtpTlsRejectUnauthorized'])
        : '';
    if (smtpPassword === null) {
      return { ok: false, message: 'The server or user changed, so the saved SMTP password can’t be used for this test. Type the password again.' };
    }
    const s: EmailSettings = { ...form, smtpPassword };
    try {
      const method = s.provider === 'smtp' ? `SMTP server ${s.smtpHost}` : 'Microsoft 365 / Exchange Online';
      await this.deliver(s, { ...testEmail({ base: await this.settings.publicUrl(), method, to }), to });
      return { ok: true, message: `Test email sent to ${to}. Check the inbox (and the junk folder).` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  private async deliver(s: EmailSettings, mail: OutgoingEmail) {
    const to = Array.isArray(mail.to) ? mail.to : [mail.to];
    const appUrl = await this.settings.publicUrl();
    // The logo travels inside the message (inline attachment), so mail apps that block remote images still show it.
    const html = renderEmailHtml(mail, { appUrl, logoSrc: `cid:${LOGO_CID}` });
    const text = renderEmailText(mail, { appUrl });
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
      await transport.sendMail({
        from: { name: s.fromName || 'Trigon', address: s.fromAddress },
        to,
        subject,
        text,
        html,
        attachments: [{ filename: 'trigon.png', content: Buffer.from(LOGO_PNG_BASE64, 'base64'), contentType: 'image/png', cid: LOGO_CID }],
      });
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
          attachments: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: 'trigon.png',
              contentType: 'image/png',
              contentBytes: LOGO_PNG_BASE64,
              contentId: LOGO_CID,
              isInline: true,
            },
          ],
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
