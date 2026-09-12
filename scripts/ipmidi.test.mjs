import test from "node:test";
import assert from "node:assert/strict";
import { IPMIDI_GROUP, IPMIDI_PORT, sendIpmidi } from "../src/lib/control/ipmidi.ts";

test("ipMIDI defaults are 225.0.0.37:21928", () => {
  assert.equal(IPMIDI_GROUP, "225.0.0.37");
  assert.equal(IPMIDI_PORT, 21928);
});

test("sendIpmidi rejects empty payload", async () => {
  const res = await sendIpmidi({ buf: Buffer.alloc(0) });
  assert.equal(res.ok, false);
});

test("sendIpmidi unicast without host fails", async () => {
  const res = await sendIpmidi({ buf: Buffer.from("903C40", "hex"), multicast: false });
  assert.equal(res.ok, false);
});
