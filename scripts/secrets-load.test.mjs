import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

function extractFns(names) {
  const file = new URL("../src/lib/control/store.server.ts", import.meta.url);
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true);
  const found = {};
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found[node.name.text] = node.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const name of names) assert.ok(found[name], `${name} exists`);
  return found;
}

function loadHelpers(secretStore) {
  const fns = extractFns(["readSecretFile", "readSecretCandidate"]);
  const body = `${fns.readSecretCandidate}\n${fns.readSecretFile}\nreturn { readSecretFile, readSecretCandidate };`;
  const js = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function("access", "readFile", "SECRET_STORE", js)(access, readFile, secretStore);
}

test("readSecretFile missing secrets file returns {} (legacy ok)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-secrets-missing-"));
  const path = join(dir, "relay-secrets.json");
  const { readSecretFile } = loadHelpers(path);
  assert.deepEqual(await readSecretFile(), {});
});

test("readSecretFile valid secrets JSON loads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-secrets-ok-"));
  const path = join(dir, "relay-secrets.json");
  writeFileSync(path, JSON.stringify({ configPin: "scrypt$test", pinChangeRequired: true }));
  const { readSecretFile } = loadHelpers(path);
  const secrets = await readSecretFile();
  assert.equal(secrets.configPin, "scrypt$test");
  assert.equal(secrets.pinChangeRequired, true);
});

test("readSecretFile corrupt JSON fails closed and does not wipe on-disk file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-secrets-corrupt-"));
  const path = join(dir, "relay-secrets.json");
  const corrupt = "{not-json";
  writeFileSync(path, corrupt);
  const { readSecretFile, readSecretCandidate } = loadHelpers(path);
  await assert.rejects(() => readSecretFile(), SyntaxError);
  await assert.rejects(() => readSecretCandidate(path), SyntaxError);
  assert.equal(readFileSync(path, "utf8"), corrupt, "corrupt secrets file must remain on disk");
});

test("readSecretFile delegates to readSecretCandidate (no fail-open catch)", () => {
  const src = readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
  const block = src.match(/async function readSecretFile\(\)[\s\S]*?\n\}/);
  assert.ok(block, "readSecretFile present");
  assert.match(block[0], /readSecretCandidate\(\s*SECRET_STORE\s*\)/);
  assert.doesNotMatch(block[0], /catch\s*\{[^}]*return\s*\{\s*\}/);
});
