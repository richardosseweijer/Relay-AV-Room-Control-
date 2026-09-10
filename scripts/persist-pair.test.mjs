import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistPair, recoverPersistPair } from "./write-atomic.mjs";

test("second write failure leaves previous secrets file unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-persist-"));
  const secrets = join(dir, "relay-secrets.json");
  const room = join(dir, "relay-room.json");
  writeFileSync(secrets, JSON.stringify({ pin: "old-secret" }));
  writeFileSync(room, JSON.stringify({ room: "old" }));
  const before = readFileSync(secrets, "utf8");
  const rename = (staged, target) => {
    if (String(target).endsWith("relay-room.json")) {
      throw Object.assign(new Error("simulated room write fail"), { code: "EIO" });
    }
    renameSync(staged, target);
  };
  assert.throws(() => persistPair(secrets, room, JSON.stringify({ pin: "new-secret" }), JSON.stringify({ room: "new" }), { rename }));
  assert.equal(readFileSync(secrets, "utf8"), before);
  assert.equal(JSON.parse(readFileSync(room, "utf8")).room, "old");
});

test("successful paired save maintains a matching last-good pair", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-persist-good-"));
  const secrets = join(dir, "relay-secrets.json");
  const room = join(dir, "relay-room.json");
  persistPair(secrets, room, "secret-1", "room-1");
  assert.equal(readFileSync(`${secrets}.good`, "utf8"), "secret-1");
  assert.equal(readFileSync(`${room}.good`, "utf8"), "room-1");
  assert.equal(existsSync(`${room}.transaction`), false);
});

test("boot recovery completes a paired save interrupted after the secrets rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-persist-crash-"));
  const secrets = join(dir, "relay-secrets.json");
  const room = join(dir, "relay-room.json");
  writeFileSync(secrets, "secret-old");
  writeFileSync(room, "room-old");
  let renames = 0;
  const stopAfterSecrets = (staged, target) => {
    renameSync(staged, target);
    renames += 1;
    // transaction, then secrets
    if (renames === 2) throw Object.assign(new Error("process stopped"), { code: "STOP" });
  };
  assert.throws(() => persistPair(secrets, room, "secret-new", "room-new", { rename: stopAfterSecrets }));
  // The thrown failure is rolled back. Model a real termination by leaving a
  // durable transaction beside the split primary pair.
  writeFileSync(`${room}.transaction`, JSON.stringify({ secretBody: "secret-new", roomBody: "room-new" }));
  writeFileSync(secrets, "secret-new");
  assert.equal(recoverPersistPair(secrets, room), true);
  assert.equal(readFileSync(secrets, "utf8"), "secret-new");
  assert.equal(readFileSync(room, "utf8"), "room-new");
  assert.equal(readFileSync(`${secrets}.good`, "utf8"), "secret-new");
  assert.equal(readFileSync(`${room}.good`, "utf8"), "room-new");
  assert.equal(existsSync(`${room}.transaction`), false);
});

test("corrupt transaction is set aside and does not throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-persist-bad-tx-"));
  const secrets = join(dir, "relay-secrets.json");
  const room = join(dir, "relay-room.json");
  writeFileSync(secrets, "secret-ok");
  writeFileSync(room, "room-ok");
  writeFileSync(`${room}.transaction`, "{not json");
  assert.equal(recoverPersistPair(secrets, room), false);
  assert.equal(readFileSync(secrets, "utf8"), "secret-ok");
  assert.equal(readFileSync(room, "utf8"), "room-ok");
  assert.equal(existsSync(`${room}.transaction`), false);
  assert.equal(existsSync(`${room}.transaction.bad`), true);
});
