/**
 * Just enough SMTP to send a notification: implicit TLS (465) or STARTTLS, AUTH PLAIN, one
 * plain-text message. With `node:net` and `node:tls` only — no mail library to keep patched for
 * the one thing it is used for.
 *
 * The server is the operator's (`EQ_SMTP_HOST`), never an address a user typed, so it does not go
 * through the SSRF guard. A password is never sent over a connection that is not encrypted.
 */
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { hostname } from "node:os";
import type { SmtpConfig } from "../../../config.ts";

export type Mail = { to: string[]; subject: string; text: string };

class Connection {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private lines: string[] = [];
  private failure: Error | null = null;

  constructor(public socket: Socket | TLSSocket) { this.attach(socket); }

  attach(socket: Socket | TLSSocket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\r\n")) >= 0) { this.lines.push(this.buffer.slice(0, index)); this.buffer = this.buffer.slice(index + 2); }
      this.flush();
    });
    socket.on("error", (error) => { this.failure = error; this.flush(); });
    socket.on("close", () => { this.failure ??= new Error("The SMTP server closed the connection"); this.flush(); });
  }

  private flush() {
    if (!this.waiting) return;
    if (this.lines.length) { const resolve = this.waiting; this.waiting = null; resolve(this.lines.shift()!); }
    else if (this.failure) { const resolve = this.waiting; this.waiting = null; resolve(`!${this.failure.message}`); }
  }

  private line() { return new Promise<string>((resolve) => { this.waiting = resolve; this.flush(); }); }

  /** A whole reply: `250-…` lines until `250 …`. Throws unless its code is one of `expected`. */
  async reply(expected: number[]) {
    const lines: string[] = [];
    for (;;) {
      const line = await this.line();
      if (line.startsWith("!")) throw new Error(line.slice(1));
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) break;
    }
    const code = Number(lines.at(-1)!.slice(0, 3));
    if (!expected.includes(code)) throw new Error(`SMTP: ${lines.at(-1)}`);
    return lines.map((line) => line.slice(4));
  }

  async command(text: string, expected: number[]) {
    this.socket.write(`${text}\r\n`);
    return this.reply(expected);
  }
}

const address = (value: string) => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();
const header = (value: string) => value.replace(/[\r\n]+/g, " ");
/** RFC 2047, so accents in a subject survive every mail client. */
const encoded = (value: string) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

function open(config: SmtpConfig, timeoutMs: number) {
  return new Promise<Socket | TLSSocket>((resolve, reject) => {
    const socket = config.secure ? connectTls({ host: config.host, port: config.port, servername: config.host }) : connectTcp({ host: config.host, port: config.port });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`SMTP: no answer from ${config.host}:${config.port} in ${timeoutMs / 1000} s`)));
    socket.once(config.secure ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function sendMail(config: SmtpConfig, mail: Mail, timeoutMs = 15_000) {
  const connection = new Connection(await open(config, timeoutMs));
  try {
    await connection.reply([220]);
    const name = hostname() || "localhost";
    let features = await connection.command(`EHLO ${name}`, [250]);
    let encrypted = config.secure;
    if (!encrypted && features.some((line) => /^STARTTLS\b/i.test(line))) {
      await connection.command("STARTTLS", [220]);
      const plain = connection.socket;
      plain.removeAllListeners("data");
      const secure = await new Promise<TLSSocket>((resolve, reject) => { const tls = connectTls({ socket: plain, servername: config.host }, () => resolve(tls)); tls.once("error", reject); });
      connection.attach(secure);
      encrypted = true;
      features = await connection.command(`EHLO ${name}`, [250]);
    }
    if (config.user) {
      if (!encrypted) throw new Error("SMTP: the server offers no TLS; the password is not sent in clear (use port 465 or a server with STARTTLS)");
      await connection.command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.password ?? ""}`).toString("base64")}`, [235]);
    }
    await connection.command(`MAIL FROM:<${address(config.from)}>`, [250]);
    for (const to of mail.to) await connection.command(`RCPT TO:<${address(to)}>`, [250, 251]);
    await connection.command("DATA", [354]);
    const body = Buffer.from(mail.text.replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{76}/g, "$&\r\n");
    const message = [`From: ${header(config.from)}`, `To: ${mail.to.map(header).join(", ")}`, `Subject: ${encoded(header(mail.subject))}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
    // Base64 never starts a line with a dot, so the message needs no dot-stuffing.
    await connection.command(`${message}\r\n.`, [250]);
    await connection.command("QUIT", [221]).catch(() => undefined);
  } finally {
    connection.socket.destroy();
  }
}
