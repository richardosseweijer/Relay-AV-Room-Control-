import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistPair } from "./write-atomic.mjs";

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
