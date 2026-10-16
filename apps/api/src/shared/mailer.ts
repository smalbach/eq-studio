/**
 * Email, for everything the API sends: password resets and run notifications. One SMTP
 * transport from the mail configuration (`EQ_SMTP_URL`, or `EQ_SMTP_HOST` and its parts; see
 * `mailConfig`), the sender from `EQ_MAIL_FROM`. Without SMTP nothing is sent and `send` answers
 * `false`: the caller decides what to do instead (the development cloud logs the link; a real
 * deployment says nothing).
 *
 * The server is the operator's, never an address a user typed, so it does not go through the
 * SSRF guard. A password is never sent over a connection that is not encrypted.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { AppConfig } from "../config.ts";
import { APP_CONFIG } from "./tokens.ts";

export type Mail = { to: string | string[]; subject: string; text: string; html?: string };

@Injectable()
export class Mailer {
  private readonly logger = new Logger("Mailer");
  private transport: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured() { return Boolean(this.config.mail?.url); }

  /** `true` once the SMTP server accepted it; `false` when there is no SMTP or it failed. */
  async send(mail: Mail): Promise<boolean> {
    if (!this.config.mail?.url) return false;
    try {
      await this.deliver(mail);
      return true;
    } catch (error) {
      // Never the message itself: it may carry a single-use link.
      this.logger.error(`Could not send an email (${mail.subject}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** Sends or throws why not: for a caller that shows the reason, like a notification's "send test". */
  async deliver(mail: Mail) {
    const url = this.config.mail?.url;
    if (!url) throw new Error("SMTP is not configured (EQ_SMTP_URL or EQ_SMTP_HOST)");
    // With credentials over plain smtp://, STARTTLS is required: no AUTH in clear.
    this.transport ??= createTransport({ url, requireTLS: !url.startsWith("smtps:") && new URL(url).username !== "", connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000 });
    await this.transport.sendMail({ from: this.config.mail!.from, ...mail });
  }
}
