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
  assert.match(spec.device.notes, /send-only/i);
  assert.match(spec.device.notes, /allowlisted/i);
  const index = JSON.parse(fs.readFileSync("data/library/index.json", "utf8"));
  assert.ok(index["telegram-bot.json"]);
});
