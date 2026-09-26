import test from "node:test";
import assert from "node:assert/strict";

test("telegram auth gate fail-closed missing token / chat_id / text", async () => {
  const { telegramAuthGate } = await import("../src/lib/control/telegram.ts");
  assert.equal(telegramAuthGate("getMe", {}).ok, false);
  assert.equal(telegramAuthGate("getMe", { token: "   " }).ok, false);
  assert.match(telegramAuthGate("getMe", {}).message, /token missing/i);

  const noChat = telegramAuthGate("sendMessage", { token: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" }, "hi");
  assert.equal(noChat.ok, false);
  assert.match(noChat.message, /chat_id missing/i);

  const noText = telegramAuthGate(
    "sendMessage",
    { token: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chat_id: "-1001" },
    "  ",
  );
  assert.equal(noText.ok, false);
  assert.match(noText.message, /text empty/i);

  const ok = telegramAuthGate(
    "sendMessage",
    { token: "123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", chat_id: "-1001" },
    " hello ",
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.text, "hello");
    assert.equal(ok.chatId, "-1001");
  }
});

test("scrubTelegramSecrets and scrubSecret strip bot tokens", async () => {
  const { scrubTelegramSecrets } = await import("../src/lib/control/telegram.ts");
  const { scrubSecret } = await import("../src/lib/control/engine-policy.ts");
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const scrubbed = scrubTelegramSecrets(url);
  assert.equal(scrubbed.includes(token), false);
  assert.match(scrubbed, /\/bot\*\*\*\//);
  assert.equal(scrubSecret(url).includes(token), false);
  assert.equal(scrubSecret(`token ${token}`).includes(token), false);
  assert.equal(scrubSecret(`{"token":"${token}"}`).includes(token), false);
});

test("telegramSendMessage success + API fail (mock)", async () => {
  const { telegramSendMessage } = await import("../src/lib/control/telegram.ts");
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  const calls = [];

  const okReq = async (url, method, body) => {
    calls.push({ url, method, body });
    assert.equal(url.includes(token), true); // request uses real token
    assert.equal(method, "POST");
    const parsed = JSON.parse(body);
    assert.equal(parsed.chat_id, "-10099");
    assert.equal(parsed.text, "room ready");
    assert.equal(parsed.parse_mode, undefined);
    return { ok: true, status: 200, text: JSON.stringify({ ok: true, result: { message_id: 1 } }) };
  };

  const ok = await telegramSendMessage({
    token,
    chatId: "-10099",
    text: "room ready",
    request: okReq,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.message.includes(token), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.telegram\.org:443\/bot/);

  const fail = await telegramSendMessage({
    token,
    chatId: "-10099",
    text: "x",
    request: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: false, description: `Unauthorized bot${token}` }),
    }),
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.message.includes(token), false);
});

test("telegramSendMessage missing token never calls network", async () => {
  const { telegramSendMessage } = await import("../src/lib/control/telegram.ts");
  let hit = false;
  const res = await telegramSendMessage({
    token: "",
    chatId: "1",
    text: "hi",
    request: async () => {
      hit = true;
      return { ok: true, status: 200, text: "{}" };
    },
  });
  assert.equal(res.ok, false);
  assert.equal(hit, false);
});

test("telegramGetMe mock returns username", async () => {
  const { telegramGetMe } = await import("../src/lib/control/telegram.ts");
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  const res = await telegramGetMe({
    token,
    request: async (url) => {
      assert.match(url, /\/getMe$/);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: "relay_room_bot" } }),
      };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.username, "relay_room_bot");
  assert.equal(res.message.includes(token), false);
});

test("sendLan telegram message.send uses adapter (mock via execute path gates)", async () => {
  // Static: engine-lan knows telegram protocol and skips LAN host gate.
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/control/engine-lan.ts", "utf8");
  assert.match(src, /"telegram"/);
  assert.match(src, /proto === "telegram"/);
  assert.match(src, /message\.send/);
  assert.match(src, /telegramSendMessage/);
  const types = fs.readFileSync("src/lib/control/types.ts", "utf8");
  assert.match(types, /"telegram"/);
});

test("library driver telegram-bot.json registers message.send", async () => {
  const fs = await import("node:fs");
  const spec = JSON.parse(fs.readFileSync("data/library/telegram-bot.json", "utf8"));
  assert.equal(spec.transports.lan.protocol, "telegram");
  assert.ok(spec.auth.instanceFields.includes("token"));
  assert.ok(spec.auth.instanceFields.includes("chat_id"));
  assert.ok(spec.commands.some((c) => c.id === "message.send"));
  assert.match(spec.device.notes, /reply-to-last/i);
  assert.match(spec.device.notes, /allowlisted/i);
  const index = JSON.parse(fs.readFileSync("data/library/index.json", "utf8"));
  assert.ok(index["telegram-bot.json"]);
});

test("rememberTelegramSend + telegramPollLastReply matching reply", async () => {
  const {
    clearTelegramRuntime,
    rememberTelegramSend,
    telegramPollLastReply,
    telegramSendMessage,
  } = await import("../src/lib/control/telegram.ts");
  clearTelegramRuntime();
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  const deviceId = "dev-tg-1";
  const chatId = "-10099";

  const send = await telegramSendMessage({
    token,
    chatId,
    text: "ping",
    deviceId,
    request: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: true, result: { message_id: 42, chat: { id: -10099 } } }),
    }),
  });
  assert.equal(send.ok, true);
  assert.equal(send.messageId, 42);

  const poll = await telegramPollLastReply({
    deviceId,
    token,
    chatId,
    request: async (url, _m, body) => {
      assert.match(url, /\/getUpdates$/);
      const parsed = JSON.parse(body);
      assert.equal(parsed.timeout, 0);
      assert.deepEqual(parsed.allowed_updates, ["message"]);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 50,
                text: "ack from room",
                chat: { id: -10099 },
                reply_to_message: { message_id: 42 },
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(poll.ok, true);
  assert.equal(poll.replyText, "ack from room");
  assert.equal(poll.replied, true);
  assert.match(poll.message, /"replied":"1"/);
  assert.equal(poll.message.includes(token), false);

  // Second poll advances offset and keeps last reply when no new match.
  const poll2 = await telegramPollLastReply({
    deviceId,
    token,
    chatId,
    request: async (_u, _m, body) => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.offset, 11);
      return { ok: true, status: 200, text: JSON.stringify({ ok: true, result: [] }) };
    },
  });
  assert.equal(poll2.ok, true);
  assert.equal(poll2.replyText, "ack from room");

  // New send clears reply.
  rememberTelegramSend(deviceId, chatId, 99);
  const afterSend = await telegramPollLastReply({
    deviceId,
    token,
    chatId,
    request: async () => ({ ok: true, status: 200, text: JSON.stringify({ ok: true, result: [] }) }),
  });
  assert.equal(afterSend.replyText, "");
  assert.equal(afterSend.replied, false);
});

test("telegramPollLastReply ignores wrong chat and non-replies", async () => {
  const { clearTelegramRuntime, rememberTelegramSend, telegramPollLastReply, telegramChatMatches } =
    await import("../src/lib/control/telegram.ts");
  clearTelegramRuntime();
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  const deviceId = "dev-tg-2";
  rememberTelegramSend(deviceId, "-10099", 7);

  assert.equal(telegramChatMatches("-10099", { id: -10099 }), true);
  assert.equal(telegramChatMatches("@RoomBot", { username: "RoomBot" }), true);
  assert.equal(telegramChatMatches("-10099", { id: -1 }), false);

  const poll = await telegramPollLastReply({
    deviceId,
    token,
    chatId: "-10099",
    request: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 1,
            message: {
              message_id: 8,
              text: "wrong chat",
              chat: { id: -1 },
              reply_to_message: { message_id: 7 },
            },
          },
          {
            update_id: 2,
            message: {
              message_id: 9,
              text: "not a reply",
              chat: { id: -10099 },
            },
          },
          {
            update_id: 3,
            message: {
              message_id: 10,
              text: "reply to older",
              chat: { id: -10099 },
              reply_to_message: { message_id: 1 },
            },
          },
        ],
      }),
    }),
  });
  assert.equal(poll.ok, true);
  assert.equal(poll.replyText, "");
  assert.equal(poll.replied, false);
});

test("telegramPollLastReply fail-closed missing token; no network before send", async () => {
  const { clearTelegramRuntime, telegramPollLastReply } = await import("../src/lib/control/telegram.ts");
  clearTelegramRuntime();
  let hit = false;
  const noToken = await telegramPollLastReply({
    deviceId: "x",
    token: "",
    chatId: "-1",
    request: async () => {
      hit = true;
      return { ok: true, status: 200, text: "{}" };
    },
  });
  assert.equal(noToken.ok, false);
  assert.equal(hit, false);
  assert.match(noToken.message, /token missing/i);

  const noSendYet = await telegramPollLastReply({
    deviceId: "fresh",
    token: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
    chatId: "-1",
    request: async () => {
      hit = true;
      return { ok: true, status: 200, text: "{}" };
    },
  });
  assert.equal(noSendYet.ok, true);
  assert.equal(noSendYet.replyText, "");
  assert.equal(hit, false);
});

test("library driver telegram-bot.json registers reply feedback", async () => {
  const fs = await import("node:fs");
  const spec = JSON.parse(fs.readFileSync("data/library/telegram-bot.json", "utf8"));
  assert.ok(spec.feedback.some((f) => f.id === "message.lastReply"));
  assert.ok(spec.feedback.some((f) => f.id === "message.replied"));
  assert.match(spec.device.notes, /reply-to-last/i);
  assert.match(spec.device.notes, /never executed/i);
  const src = fs.readFileSync("src/lib/control/engine-lan.ts", "utf8");
  assert.match(src, /telegramPollLastReply/);
  assert.match(src, /isTelegramReplyFeedback/);
});
