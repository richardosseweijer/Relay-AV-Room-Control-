/**
 * Telegram Bot API adapter.
 *
 * MR1: send-only (sendMessage / getMe).
 * MR2 (0.9.73): inbound poll limited to replies to the last message Relay sent
 * via this device — getUpdates with offset tracking. Not a general command
 * channel; reply text is never executed as shell/macros.
 * Offset (and poll serial) is keyed by bot token, not device id — Bot API
 * getUpdates cursor is per token; devices sharing one BotFather token share one.
 *
 * Host is fixed to api.telegram.org (allowlisted cloud HTTPS). Device card Host
 * is unused. Bind via nicFace (prefer Venue / outbound). System CA trust —
 * public Bot API certs; does not weaken venue pin/CA rules for LAN gear.
 *
 * No webhook. Fail-closed if token missing.
 */
import type { CommandResult } from "./types.ts";
import { requestHttpExact, DEFAULT_MAX_RESPONSE_BYTES } from "./http-client.ts";
import { scrubSecret } from "./engine-policy.ts";

export const TELEGRAM_API_HOST = "api.telegram.org";
export const TELEGRAM_API_PORT = 443;

/** Cap stored reply text (never executed — size bound only). */
export const TELEGRAM_REPLY_TEXT_MAX = 500;

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

export type TelegramMethod = "getMe" | "sendMessage" | "getUpdates";

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

/**
 * Per-device runtime (process memory — not room JSON).
 * lastMessageId / lastChatId / lastReplyText stay device-scoped (each card has its own last send).
 * getUpdates offset is NOT here — Bot API offset is per bot token (see TelegramTokenRuntime).
 */
export type TelegramDeviceRuntime = {
  lastMessageId?: number;
  lastChatId?: string;
  lastReplyText?: string;
};

/**
 * Per-bot-token runtime. Telegram getUpdates offset is global for a BotFather token:
 * two Relay devices sharing one token must share one cursor (and serialize polls).
 */
export type TelegramTokenRuntime = {
  /** Next getUpdates offset (update_id + 1). */
  updateOffset?: number;
  /** Devices that sent or polled with this token (fan-out matching replies). */
  deviceIds: Set<string>;
};

type TelegramGlobal = typeof globalThis & {
  __relayTelegram__?: Map<string, TelegramDeviceRuntime>;
  __relayTelegramTokens__?: Map<string, TelegramTokenRuntime>;
  __relayTelegramPollTails__?: Map<string, Promise<unknown>>;
};

function deviceRuntimeMap(): Map<string, TelegramDeviceRuntime> {
  const g = globalThis as TelegramGlobal;
  return (g.__relayTelegram__ ??= new Map());
}

function tokenRuntimeMap(): Map<string, TelegramTokenRuntime> {
  const g = globalThis as TelegramGlobal;
  return (g.__relayTelegramTokens__ ??= new Map());
}

function pollTailMap(): Map<string, Promise<unknown>> {
  const g = globalThis as TelegramGlobal;
  return (g.__relayTelegramPollTails__ ??= new Map());
}

/** Test / prune helper — device-scoped slot. */
export function telegramRuntimeSlot(deviceId: string): TelegramDeviceRuntime {
  const map = deviceRuntimeMap();
  let slot = map.get(deviceId);
  if (!slot) {
    slot = {};
    map.set(deviceId, slot);
  }
  return slot;
}

/** Test helper — token-scoped getUpdates cursor (key = normalized bot token). */
export function telegramTokenSlot(token: string): TelegramTokenRuntime {
  const key = normalizeBotToken(token);
  const map = tokenRuntimeMap();
  let slot = map.get(key);
  if (!slot) {
    slot = { deviceIds: new Set() };
    map.set(key, slot);
  }
  return slot;
}

function registerDeviceOnToken(token: string, deviceId: string) {
  const key = normalizeBotToken(token);
  const id = String(deviceId || "").trim();
  if (!key || !id) return;
  telegramTokenSlot(key).deviceIds.add(id);
}

/**
 * Serialize getUpdates for one bot token so concurrent device polls cannot
 * race read/advance of the shared offset.
 */
function withTokenPollLock<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const key = normalizeBotToken(token);
  const tails = pollTailMap();
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, done);
  void done.then(() => {
    if (tails.get(key) === done) tails.delete(key);
  });
  return run;
}

/** Clear process-global telegram runtime (tests). */
export function clearTelegramRuntime() {
  deviceRuntimeMap().clear();
  tokenRuntimeMap().clear();
  pollTailMap().clear();
}

export function rememberTelegramSend(
  deviceId: string,
  chatId: string,
  messageId: number,
  token?: string,
) {
  const id = String(deviceId || "").trim();
  if (!id || !Number.isFinite(messageId) || messageId <= 0) return;
  const slot = telegramRuntimeSlot(id);
  slot.lastMessageId = messageId;
  slot.lastChatId = normalizeChatId(chatId);
  // New outbound message — clear prior reply so monitors see a fresh edge.
  slot.lastReplyText = "";
  if (token) registerDeviceOnToken(token, id);
}

export function parseTelegramMessageId(raw: string | undefined | null): number | undefined {
  try {
    const parsed = JSON.parse(String(raw ?? "")) as { result?: { message_id?: number } };
    const mid = Number(parsed.result?.message_id);
    if (Number.isFinite(mid) && mid > 0) return mid;
  } catch {
    /* optional */
  }
  return undefined;
}

/** Configured chat_id vs Update message.chat (numeric id or @username). */
export function telegramChatMatches(
  configured: string,
  chat: { id?: number | string; username?: string } | undefined | null,
): boolean {
  const want = normalizeChatId(configured);
  if (!want || !chat) return false;
  if (chat.id !== undefined && chat.id !== null && String(chat.id) === want) return true;
  const uname = String(chat.username ?? "").trim();
  if (!uname) return false;
  const at = `@${uname}`;
  if (want.startsWith("@")) return want.toLowerCase() === at.toLowerCase();
  return want.toLowerCase() === uname.toLowerCase();
}

function buildApiUrl(token: string, method: string): string {
  // Path-only construction — host/port fixed (no SSRF via device.host).
  const path = `/bot${token}/${method}`;
  return `https://${TELEGRAM_API_HOST}:${TELEGRAM_API_PORT}${path}`;
}

/**
 * Fail-closed gates before any network I/O.
 * getMe / getUpdates need token; sendMessage needs token + chat_id + non-empty text.
 * getUpdates also requires chat_id (configured destination — ignore other chats).
 */
export function telegramAuthGate(
  kind: "getMe" | "sendMessage" | "getUpdates",
  auth: { token?: string; chat_id?: string } | undefined,
  text?: string,
): { ok: true; token: string; chatId?: string; text?: string } | { ok: false; message: string } {
  const token = normalizeBotToken(auth?.token);
  if (!token) return { ok: false, message: "Telegram bot token missing (Secret/Token field)" };
  if (kind === "getMe") return { ok: true, token };
  const chatId = normalizeChatId(auth?.chat_id);
  if (!chatId) return { ok: false, message: "Telegram chat_id missing (required for send/reply poll)" };
  if (kind === "getUpdates") return { ok: true, token, chatId };
  const msg = String(text ?? "").trim();
  if (!msg) return { ok: false, message: "Telegram message text empty" };
  return { ok: true, token, chatId, text: msg };
}

function scrubForParse(raw: string): string {
  return raw
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/gi, "/bot***")
    .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***")
    .slice(0, 400);
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
      const forParse = scrubForParse(raw);
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
  /** When set, remember message_id in process runtime for reply monitors. */
  deviceId?: string;
}): Promise<CommandResult & { messageId?: number }> {
  const gate = telegramAuthGate("sendMessage", { token: opts.token, chat_id: opts.chatId }, opts.text);
  if (!gate.ok) return gate;
  const result = await telegramApi({
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
  if (!result.ok) return result;
  const messageId = parseTelegramMessageId((result as { raw?: string }).raw || result.message);
  if (messageId && opts.deviceId) {
    rememberTelegramSend(opts.deviceId, gate.chatId!, messageId, gate.token);
  }
  return messageId ? { ...result, messageId } : result;
}

type TgChat = { id?: number | string; username?: string };
type TgMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: TgChat;
  reply_to_message?: { message_id?: number };
};
type TgUpdate = { update_id?: number; message?: TgMessage };

/**
 * Short-poll getUpdates; keep only replies in the configured chat to the last
 * message this device sent. Offset is per bot token (shared + serialized across
 * devices that reuse one BotFather token). Never executes text.
 */
export async function telegramPollLastReply(opts: {
  deviceId: string;
  token: string;
  chatId: string;
  localAddress?: string;
  timeoutMs?: number;
  request?: TelegramRequestFn;
}): Promise<CommandResult & { replyText?: string; replied?: boolean }> {
  const gate = telegramAuthGate("getUpdates", { token: opts.token, chat_id: opts.chatId });
  if (!gate.ok) return gate;

  const deviceId = String(opts.deviceId || "").trim();
  if (!deviceId) return { ok: false, message: "Telegram device id missing" };

  const slot = telegramRuntimeSlot(deviceId);
  registerDeviceOnToken(gate.token, deviceId);
  const lastId = slot.lastMessageId;
  // No outbound message yet — nothing to match; skip network (fail soft).
  if (!lastId) {
    const empty = { ok: true, result: { text: "", replied: "0" } };
    return { ok: true, message: JSON.stringify(empty), replyText: "", replied: false };
  }

  return withTokenPollLock(gate.token, async () => {
    const tokenSlot = telegramTokenSlot(gate.token);
    const body: Record<string, unknown> = {
      limit: 100,
      timeout: 0,
      allowed_updates: ["message"],
    };
    if (typeof tokenSlot.updateOffset === "number" && Number.isFinite(tokenSlot.updateOffset)) {
      body.offset = tokenSlot.updateOffset;
    }

    const result = await telegramApi({
      token: gate.token,
      method: "getUpdates",
      body,
      localAddress: opts.localAddress,
      // Short poll — monitor cadence owns pacing; keep HTTP wait modest.
      timeoutMs: Math.min(opts.timeoutMs ?? 8000, 10000),
      request: opts.request,
    });
    if (!result.ok) return result;

    const source = (result as { raw?: string }).raw || result.message;
    let updates: TgUpdate[] = [];
    try {
      const parsed = JSON.parse(source) as { result?: TgUpdate[] };
      updates = Array.isArray(parsed.result) ? parsed.result : [];
    } catch {
      return { ok: false, message: "Telegram getUpdates parse failed" };
    }

    let maxUpdateId = -1;
    // Fan-out: one getUpdates batch must feed every device sharing this token,
    // otherwise advancing the shared offset would drop another card's reply.
    const peerIds = new Set(tokenSlot.deviceIds);
    peerIds.add(deviceId);

    for (const upd of updates) {
      const uid = Number(upd.update_id);
      if (Number.isFinite(uid) && uid > maxUpdateId) maxUpdateId = uid;
      const msg = upd.message;
      if (!msg) continue;
      const replyTo = Number(msg.reply_to_message?.message_id);
      if (!Number.isFinite(replyTo)) continue;
      const text = String(msg.text ?? msg.caption ?? "").trim().slice(0, TELEGRAM_REPLY_TEXT_MAX);
      for (const peerId of peerIds) {
        const peer = telegramRuntimeSlot(peerId);
        const peerChat = peer.lastChatId || (peerId === deviceId ? gate.chatId! : "");
        if (!peerChat || !telegramChatMatches(peerChat, msg.chat)) continue;
        if (peer.lastMessageId !== replyTo) continue;
        // Latest matching reply in this batch wins per device.
        peer.lastReplyText = text;
      }
    }

    if (maxUpdateId >= 0) {
      tokenSlot.updateOffset = maxUpdateId + 1;
    }

    const replyText = String(slot.lastReplyText ?? "");
    const replied = replyText.length > 0;
    // Shape for jsonpath feedback parse — scrub any token-shaped substrings in reply text.
    const safeText = scrubTelegramSecrets(replyText).slice(0, TELEGRAM_REPLY_TEXT_MAX);
    const payload = {
      ok: true,
      result: {
        text: safeText,
        replied: replied ? "1" : "0",
      },
    };
    return {
      ok: true,
      message: JSON.stringify(payload),
      replyText: safeText,
      replied,
    };
  });
}

/** True when this driver uses the Telegram Bot API plane. */
export function isTelegramDriver(driver: { transports?: { lan?: { protocol?: string } } } | undefined): boolean {
  return String(driver?.transports?.lan?.protocol || "").toLowerCase() === "telegram";
}

/** Feedback ids that poll getUpdates for reply-to-last-send. */
export function isTelegramReplyFeedback(feedbackId: string): boolean {
  const id = String(feedbackId || "").toLowerCase();
  return id === "message.lastreply" || id === "message.replied" || id === "message.reply";
}
