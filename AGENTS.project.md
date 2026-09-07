# Relay — standing orders (non-negotiable)

You are finishing an existing LAN AV room controller in this repo.
Goal: raise correctness, not add features, not rewrite the product.

This file overrides `AGENTS.md` for product work. `AGENTS.md` is App Builder
platform contract. Do not follow it when it conflicts with the bans below
(especially “keep factory chrome” vs Phase 1 cleanup).

## Mission

Close the defects listed in PHASES. Produce software a strict reviewer can
defend: installable, bounded, tested, no leftover factory chrome in the
*product* path.

## Hard bans

- No new features, transports, drivers, UI tabs, or “nice to have.”
- No new markdown files except updates to `KNOWN_ISSUES.md`, `CHANGELOG.md`,
  `README.md`, `SECURITY.md` when a fact changes.
- No drive-by refactors of files outside the current phase’s allow-list.
- No new dependencies unless a phase explicitly requires one, and then only
  after `npm ci` still works.
- Do not “improve” names, colours, copy, or architecture docs for style.
- Do not invent TLS, a rewrite in another language, a second process, or a
  cloud API.
- Do not weaken security to make a test pass.
- If a change would break a running room on a Pi (`data/relay-*.json`,
  systemd, port 8081), stop and report. Do not “fix forward” with a different
  port in one file and the old port in another.

## Platform vs product (read before deleting anything)

This tree grew inside an app-builder scaffold.

PRODUCT (you may change in the listed phases):
`src/lib/control/**`, `src/components/panel/**`, `src/components/config/**`,
`src/routes/index.tsx`, `src/routes/config.tsx`,
`src/routes/api/{room,peer,ping,vars,config-unlock,panel-unlock}.ts`,
`data/drivers/**`, `scripts/driver-check.mjs`, `scripts/update-relay.mjs`,
`scripts/write-atomic.mjs`, `scripts/room-smoke.mjs`,
`scripts/control-security.test.mjs`, `LINUX.md`, `WINDOWS.md`, `README.md`,
`SECURITY.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`, `ARCHITECTURE.md` (facts
only), `.gitignore`, `package.json` scripts that the room actually uses.

PLATFORM (do not delete unless a phase says so AND `npm run dev`,
`npm run build`, and `npm run typecheck` still pass):
`vite.config.ts` contracts, `scripts/with-app-env.mjs`, `startup.sh`,
`src/router.tsx`, `src/routes/__root.tsx`, `src/styles.css`.

If a file exists only to satisfy the builder (`.grok/**`, `AGENTS.md`,
`scripts/grok-pwa-*`, `scripts/brand-check*`, `scripts/preview-thumbnail.mjs`,
`.vercel/**`) you may remove it ONLY in Phase 1, and ONLY after proving
dev/build/typecheck still work. If removing a file breaks the preview host,
put it back immediately and list it under “kept because platform” instead of
fighting the host.

## Double-check protocol (every phase)

After EACH phase, before starting the next:

1. `npm ci` must succeed. If the lockfile is stale, fix the lockfile in that
   same phase (`npm install` then commit the lockfile). Never leave “use npm
   install instead of npm ci” as the documented path.
2. `npm run typecheck`
3. `npm run test` — must stay green. If you delete a failing *scaffold* test,
   you must say why it was not a product invariant.
4. `npm run lint` if it is cheap; do not spend the phase “fixing lint
   neighbourhoods.”
5. Grep gates (fail the phase if any hit after the relevant phase):
   - product code importing `@/lib/db`, `better-auth`, `getSql`, `getPglite`
   - `npx vite` in README/LINUX/WINDOWS (must be `npm run dev` / `npm start`)
   - port numbers other than the single chosen port in those same docs
   - `system.reboot` / `system.update` / `system.restart` callable without a
     valid config session
6. Write 5–10 lines in the chat: what changed, commands run, exit codes,
   files touched. Then STOP that phase.

If any gate is red: revert the phase or fix only that regression.
Do not open Phase N+1 on a red tree.

## Definition of done (stop when these are true)

- `npm ci && npm run typecheck && npm run test` all exit 0 on a clean clone.
- One documented start command and one port, consistent in README, LINUX.md,
  WINDOWS.md, package.json.
- Product path has no Better Auth / PGLite / unused db bootstrap.
- Room+secrets persist is one atomic operation (or proven equivalent).
- HMAC, PIN, persist, allowLanControl, and admin-command tests exist and pass.
- Forget tablet clears or instructs the client to drop the stored token.
- Panel PIN does not accept the config PIN unless an explicit opt-in flag is
  on (default off).
- Host binary argv is allowlisted; driver payload is not unsanitised argv.
- `.gitignore` prevents `.grok/`, `.vercel/`, secrets, and `node_modules`.
- `KNOWN_ISSUES.md` only contains issues that still exist.
- No new open questions you created.

# PHASES (do in order, one phase per turn unless a phase is trivially small)

## Phase 0 — inventory, no edits

List: start scripts and ports; whether `src/lib/db.ts` is imported from
product files; whether `better-auth` is imported; failing tests by name; what
`.gitignore` misses. Do not edit.

## Phase 1 — boundary

- Fix repo hygiene you can fix in-tree: `.gitignore` adds `.grok/`, `.vercel/`,
  `*.log` under `.grok`, OS junk.
- Remove only unused *product* imports of db/auth.
- If `better-auth`, `pglite`, `kysely`, `pg` are unused after grep, remove them
  from package.json and refresh the lockfile so `npm ci` works.
- Do not rename the GitHub repo from here (cannot). Fix README spelling
  (“integration”) if present.
- Align README start command with package.json. Pick ONE port and use it
  everywhere you document a URL. Prefer the production panel port already used
  in LINUX.md (8081) for preview/start; keep `dev` on whatever the platform
  requires but document both in one table, not two conflicting sentences.

Gate: ci, typecheck, test.

## Phase 2 — persist atomicity (issue #18)

Implement a single persist path: write room + secrets to temp files, fsync,
then rename into place as one logical commit (already have
`scripts/write-atomic.mjs` — use it from `persistNow`). If one write fails,
leave the previous pair intact and return failure (dirty flag stays set).
Add a test that simulates failure of the second write and asserts the previous
secrets file is unchanged.
Do not change the on-disk schema except if you must add a generation counter.

Gate: tests for persist + existing suite.

## Phase 3 — session and PIN trust (issues #17 and split PIN)

- Persist session metadata without storing the raw secret in the room export;
  secret may live in secrets file keyed by id, never in `/api/room` snapshots.
- `revokeSession` / Forget: return a flag the panel must honour by deleting
  `localStorage` keys for the token. Implement that client delete in the panel.
  If the browser still has a token after Forget, the phase is failed.
- Panel unlock: accept config PIN only when `room.panelAcceptsConfigPin === true`
  (default false). Keep the documented behaviour as an opt-in.
- Sliding TTL may stay, but expired rows must be deleted from both memory and
  secrets on sight.

Tests: Forget clears client key (unit or small integration); config PIN
rejected on panel when flag is false; expired token rejected.

Gate: typecheck, test.

## Phase 4 — control plane tests (issues #20, admin path)

Add tests next to `scripts/control-security.test.mjs` (or a sibling):

- HMAC: good sig; replay of same ts+body; uppercase hex rejected; empty key
  rejected; skew > 90s rejected; wrong path rejected.
- `allowLanControl`: off + no token → deny; off + panel token → allow
  fireMacro/fireCommand; on + no token → allow those three only.
- `system.restart|update|reboot` denied without config token even when open
  LAN is on.
- Trigger `change` fires once per edge; `interval` can re-fire; empty schedule
  days: match the CURRENT documented behaviour and test that behaviour (do not
  silently change it).

Do not mock the entire engine if you can test the pure functions.
If you must extract a function from `actions.ts` / `store.server.ts` to test
it, extract the minimum.

Gate: test file names listed in the phase report.

## Phase 5 — engine safety (no new transports)

In `engine.ts` / `sendLocal` only:

- `allowedLanHost` stays deny-by-default. Do not add “any hostname.”
- GPIO / i2c / ir / cec / spi: build argv from an allowlist (chip, line, bus,
  address regex, scancode charset). Payload must not be `split` into raw argv
  without validation.
- Keep connect-write-close. Do not “fix” issue #4 in this pass (persistent
  sockets are a later assignment). Add one comment at the send site pointing
  at KNOWN_ISSUES #4 so nobody “cleverly” opens a long-lived socket this week.

Gate: typecheck, existing `driver:check` still runs on one bundled driver.

## Phase 6 — issues list and README truth

- Close or rewrite `KNOWN_ISSUES.md` so every bullet is still true.
- `SECURITY.md` must match actual PIN rules after Phase 3.
- CHANGELOG: one section, facts only.
- Remove claims you did not prove (“audited”, “production ready”).
- Keep the AI-generated disclaimer until a human actually reviews it.

## Phase 7 — stop

Print a scorecard against the “Definition of done” list: PASS/FAIL per line,
with evidence (command + exit code or file:line).
Do not start extra work.

# How you work

- Read a file before you patch it.
- Prefer extract-function over copy-paste.
- If stuck for more than one retry on the same error, stop and ask.
- Never commit secrets. Never print PIN material in logs.
- One phase per turn unless the operator names two consecutive phases that
  are both already green.

# Kickoff lines (operator pastes one)

```text
Execute Phase 0 only. Inventory. No file writes. Then wait.
```

```text
Execute Phase 1 only. Stop on red gates. Do not start Phase 2.
```
