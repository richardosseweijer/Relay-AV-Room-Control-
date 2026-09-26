/**
 * Telegram Bot API adapter (MR1 — send-only).
 *
 * Host is fixed to api.telegram.org (allowlisted cloud HTTPS). Device card Host
 * is unused. Bind via nicFace (prefer Venue / outbound). System CA trust —
 * public Bot API certs; does not weaken venue pin/CA rules for LAN gear.
 *
 * No getUpdates / webhook in this version (inbound attack surface deferred).
 */
import type { CommandResult } from "./types.ts";
import { requestHttpExact, DEFAULT_MAX_RESPONSE_BYTES } from "./http-client.ts";
import { scrubSecret } from "./engine-policy.ts";

export const TELEGRAM_API_HOST = "api.telegram.org";
export const TELEGRAM_API_PORT = 443;

/** BotFather tokens look like 123456:AAH… — never accept empty / whitespace. */
export function normalizeBotToken(raw: string | undefined | null): string {
  return String(raw ?? "").trim();
}

export function normalizeChatId(raw: string | undefined | null): string {
  return String(raw ?? "").trim();
}

/** Scrub /botTOKEN/ path segments and BotFather-shaped literals from free text. */
export function scrubTelegramSecrets(text: string): string {
  // scrubSecret already covers BotFather-shaped literals + /botTOKEN paths.
  return scrubSecret(String(text ?? ""));
}

export type TelegramMethod = "getMe" | "sendMessage";

export type TelegramRequestFn = (
  url: string,
  method: string,
  body: string,
  headers: Record<string, string>,
  timeout: number,
  maxBytes: number,
  localAddress?: string,
  rejectUnauthorized?: boolean,
) => Promise<{ ok: boolean; status: number; text: string }>;

export type TelegramApiOpts = {
  token: string;
  method: TelegramMethod;
  /** JSON body fields (sendMessage: chat_id, text, …). */
  body?: Record<string, unknown>;
  localAddress?: string;
  timeoutMs?: number;
  /** Inject for unit tests. */
  request?: TelegramRequestFn;
};

function buildApiUrl(token: string, method: string): string {
  // Path-only construction — host/port fixed (no SSRF via device.host).
  const path = `/bot${token}/${method}`;
  return `https://${TELEGRAM_API_HOST}:${TELEGRAM_API_PORT}${path}`;
}

/**
 * Fail-closed gates before any network I/O.
 * getMe needs token only; sendMessage needs token + chat_id + non-empty text.
 */
export function telegramAuthGate(
  kind: "getMe" | "sendMessage",
  auth: { token?: string; chat_id?: string } | undefined,
  text?: string,
): { ok: true; token: string; chatId?: string; text?: string } | { ok: false; message: string } {
  const token = normalizeBotToken(auth?.token);
  if (!token) return { ok: false, message: "Telegram bot token missing (Secret/Token field)" };
  if (kind === "getMe") return { ok: true, token };
  const chatId = normalizeChatId(auth?.chat_id);
  if (!chatId) return { ok: false, message: "Telegram chat_id missing (required for send)" };
  const msg = String(text ?? "").trim();
  if (!msg) return { ok: false, message: "Telegram message text empty" };
  return { ok: true, token, chatId, text: msg };
}

export async function telegramApi(opts: TelegramApiOpts): Promise<CommandResult & { raw?: string }> {
  const token = normalizeBotToken(opts.token);
  if (!token) return { ok: false, message: "Telegram bot token missing (Secret/Token field)" };

  const url = buildApiUrl(token, opts.method);
  const payload = opts.body ? JSON.stringify(opts.body) : "";
  const timeout = Math.max(opts.timeoutMs ?? 8000, 1500);
  const request = opts.request ?? requestHttpExact;

  try {
    const res = await request(
      url,
      "POST",
      payload,
      { "content-type": "application/json" },
      timeout,
      DEFAULT_MAX_RESPONSE_BYTES,
      opts.localAddress,
      true, // system CA trust for public Bot API
    );
    const raw = String(res.text ?? "");
    const scrubbed = scrubTelegramSecrets(raw).slice(0, 400);
    if (!res.ok) {
      return { ok: false, message: scrubbed || `Telegram HTTP ${res.status}`, raw };
    }
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean; description?: string; result?: unknown };
      if (parsed.ok === false) {
        return {
          ok: false,
          message: scrubTelegramSecrets(parsed.description || scrubbed || "Telegram API error"),
          raw,
        };
      }
      // Return scrubbed JSON for feedback parse (bot.username): isSecretKey("username")
      // would turn the value into *** if we scrubbed first — keep structural keys, scrub token only.
      const forParse = raw
        .replace(/\/bot\d+:[A-Za-z0-9_-]+/gi, "/bot***")
        .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***")
        .slice(0, 400);
      return { ok: true, message: forParse || "ok", raw };
    } catch {
      return { ok: res.ok, message: scrubbed || String(res.status), raw };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "telegram failed";
    return { ok: false, message: scrubTelegramSecrets(msg) };
  }
}

export async function telegramGetMe(opts: {
  token: string;
  localAddress?: string;
  timeoutMs?: number;
  request?: TelegramRequestFn;
}): Promise<CommandResult & { username?: string }> {
  const gate = telegramAuthGate("getMe", { token: opts.token });
  if (!gate.ok) return gate;
  const result = await telegramApi({
    token: gate.token,
    method: "getMe",
    body: {},
    localAddress: opts.localAddress,
    timeoutMs: opts.timeoutMs,
    request: opts.request,
  });
  if (!result.ok) return result;
  let username: string | undefined;
  const source = (result as { raw?: string }).raw || result.message;
  try {
    const parsed = JSON.parse(source) as { result?: { username?: string } };
    const u = String(parsed.result?.username ?? "").trim();
    // Ignore scrub placeholders
    if (u && u !== "***") username = u;
  } catch {
    /* optional */
  }
  return username ? { ...result, username } : result;
}

export async function telegramSendMessage(opts: {
  token: string;
  chatId: string;
  text: string;
  localAddress?: string;
  timeoutMs?: number;
  /** Plain text default — no parse_mode (Markdown/HTML off). */
  request?: TelegramRequestFn;
}): Promise<CommandResult> {
  const gate = telegramAuthGate("sendMessage", { token: opts.token, chat_id: opts.chatId }, opts.text);
  if (!gate.ok) return gate;
  return telegramApi({
    token: gate.token,
    method: "sendMessage",
    body: {
      chat_id: gate.chatId,
      text: gate.text,
      // parse_mode intentionally omitted (plain text)
      disable_web_page_preview: true,
    },
    localAddress: opts.localAddress,
    timeoutMs: opts.timeoutMs,
    request: opts.request,
  });
}

/** True when this driver uses the Telegram Bot API plane. */
export function isTelegramDriver(driver: { transports?: { lan?: { protocol?: string } } } | undefined): boolean {
  return String(driver?.transports?.lan?.protocol || "").toLowerCase() === "telegram";
}
