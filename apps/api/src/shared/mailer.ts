/**
 * Email, for everything the API sends: password resets today, notifications next. One SMTP
 * transport from `EQ_SMTP_URL` (`smtp://user:pass@host:587`, `smtps://…:465`), the sender from
 * `EQ_MAIL_FROM`. Without a URL nothing is sent and `send` answers `false`: the caller decides
 * what to do instead (the development cloud logs the link; a real deployment says nothing).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { AppConfig } from "../config.ts";
import { APP_CONFIG } from "./tokens.ts";

export type Mail = { to: string; subject: string; text: string; html?: string };

@Injectable()
export class Mailer {
  private readonly logger = new Logger("Mailer");
  private transport: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured() { return Boolean(this.config.mail?.url); }

  /** `true` once the SMTP server accepted it; `false` when there is no SMTP or it failed. */
  async send(mail: Mail): Promise<boolean> {
    if (!this.config.mail?.url) return false;
    this.transport ??= createTransport(this.config.mail.url);
    try {
      await this.transport.sendMail({ from: this.config.mail.from, ...mail });
      return true;
    } catch (error) {
      // Never the message itself: it may carry a single-use link.
      this.logger.error(`Could not send an email (${mail.subject}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
