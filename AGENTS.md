# Relay — agent contract

This is the only instruction file that matters.
`AGENTS.project.md` points here. Ignore any older App Builder copy of this
filename if you still have it in context.

You are finishing an existing LAN AV room controller. Raise correctness.
Do not add features. Do not rewrite the product. Do not invent a second app.

## Mission

Close the phased defects below. A reviewer must be able to clone, install,
and defend the control plane: persist, PIN/session, HMAC, LAN policy, host
admin commands.

## Hard bans

- No new features, transports, drivers, UI tabs, or polish-for-its-own-sake.
- No new markdown except factual edits to `README.md`, `SECURITY.md`,
  `KNOWN_ISSUES.md`, `CHANGELOG.md`, `ARCHITECTURE.md`.
- No drive-by refactors outside the current phase allow-list.
- No new dependencies unless a phase requires one and `npm ci` still works.
- Do not invent TLS, a second process, a cloud API, or a language rewrite.
- Do not weaken security to make a test pass.
- Do not invent tools (`imagine_*` or otherwise) that are not in your tool list.
- Do not add Grok/xAI API calls (`XAI_API_KEY` spends the owner’s quota).
- Do not commit `.env`, secrets, or PIN material. Do not print PINs in logs.
- Do not start Vite with raw `vite` / `npx vite`. Use `npm run dev` or
  `npm start` so `scripts/with-app-env.mjs` runs.
- Do not recreate `vite.config.ts` or `tsconfig.json` from a template. Keep
  the existing TanStack Start contracts (`export function getRouter()`, file
  routes). Edit them only when a phase requires a factual change.
- If a change would break a running Pi room (`data/relay-*.json`, systemd,
  documented port), stop and report. Do not fix one file’s port and leave
  another file on the old port.

## Two runtimes (read this once)

**A. Local / Grok CLI / any coding agent on a git clone**  
This file is the whole law. Product path wins. You may remove unused factory
chrome in Phase 1 after gates pass.

**B. App Builder sandbox / chat preview**  
You are on someone else’s preview host. Extra boot rules, *only* in this mode:

- Keep the app reachable on `0.0.0.0:8080` via `npm run dev` while you work.
- Do not delete `startup.sh`. Keep it starting `npm run dev`, not raw Vite.
- Do not delete `scripts/with-app-env.mjs`.
- If removing `scripts/grok-pwa-*`, `public/__grok/`, branding, or
  `PreviewHostBridge` blanks the preview, put them back the same turn and
  list them under “kept because platform.”
- Do not tell the preview-only user to open `localhost`. Still print command
  exit codes in the *agent* log.
- Runtime writes to `data/` work in the sandbox and on a Pi. They do **not**
  work on grok.me / Vercel. Do not “fix” persist by targeting serverless.

Never follow sandbox habits that contradict the hard bans (do not invent an
app, do not keep Better Auth “just in case,” do not treat a green preview as
done).

## Platform vs product

PRODUCT (phases may change):  
`src/lib/control/**`, `src/components/panel/**`, `src/components/config/**`,
`src/routes/index.tsx`, `src/routes/config.tsx`,
`src/routes/api/{room,peer,ping,vars,config-unlock,panel-unlock}.ts`,
`data/drivers/**`, `scripts/driver-check.mjs`, `scripts/update-relay.mjs`,
`scripts/write-atomic.mjs`, `scripts/room-smoke.mjs`,
`scripts/control-security.test.mjs`, `LINUX.md`, `WINDOWS.md`, `README.md`,
`SECURITY.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`, `ARCHITECTURE.md` (facts),
`.gitignore`, product scripts in `package.json`.

PLATFORM (touch only to keep boot working):  
`vite.config.ts` contracts, `tsconfig.json`, `scripts/with-app-env.mjs`,
`startup.sh`, `src/router.tsx`, `src/routes/__root.tsx`, `src/styles.css`.

FACTORY (Phase 1 only, and only if gates stay green):  
`.grok/**`, this file’s historical App Builder skills tree, `scripts/grok-pwa-*`,
`scripts/brand-check*`, `scripts/preview-thumbnail.mjs`, `.vercel/**`, unused
`src/lib/db.ts` / Better Auth / PGLite / Kysely / `pg` if grep shows no
product imports.

Do not read `.grok/skills/building-games` or other factory skills for this
product. They are how game chrome landed in an AV controller.

## Auth and database

Relay persists `data/relay-room.json` and `data/relay-secrets.json`.  
Do not turn Better Auth or Postgres back on. Do not import `@/lib/db`,
`getSql`, `getPglite`, or `better-auth` from product code. If those modules
still exist after Phase 1, they must not be on the room control path.

## Double-check protocol (every phase)

After each phase, before the next:

1. `npm ci` — lockfile must install. If it does not, fix the lockfile in the
   same phase. Never document “use npm install instead.”
2. `npm run typecheck`
3. `npm run test` — stay green. Deleting a failing *scaffold* test requires a
   one-line reason that it was not a product invariant.
4. `npm run build` — required at the end of Phases 1, 3, and 5, and before
   you claim the tree is done. Dev can render while the production bundle
   does not.
5. `npm run lint` only if cheap. Do not spend a phase on lint neighbourhoods.
6. Grep gates after the relevant phase:
   - product code importing `@/lib/db`, `better-auth`, `getSql`, `getPglite`
   - `npx vite` or bare `vite` in README / LINUX.md / WINDOWS.md
   - conflicting ports in those docs (one table: `dev` vs `start`/`preview`)
   - `system.reboot` / `system.update` / `system.restart` callable without a
     valid config session
7. Phase 3 also needs a panel check: Forget must drop the browser token.
   Use `scripts/browser-smoke.mjs` or an equivalent if the panel UI changed.
8. Report 5–10 lines: files touched, commands, exit codes. Then STOP.

Red gate → revert or fix only that regression. No Phase N+1 on a red tree.

Do not kill a running dev server unless `vite.config` or dependencies changed.

## Parallel work

Default: one agent, one phase, sequential files.  
Do not fan out sub-agents onto `actions.ts`, `store.server.ts`, `engine.ts`,
or persist. Those files are one-writer problems.

If you parallelise anything else: shared types and file ownership first,
non-overlapping paths, then integrate.

## Definition of done

- `npm ci && npm run typecheck && npm run test && npm run build` exit 0 on a
  clean clone.
- One documented start command; `dev` vs production port listed in one table
  in README, LINUX.md, WINDOWS.md, package.json — no contradictions.
- Product path has no Better Auth / PGLite / unused db bootstrap.
- Room + secrets persist is one atomic operation (or proven equivalent).
- HMAC, PIN, persist, allowLanControl, and admin-command tests exist and pass.
- Forget tablet clears or instructs the client to drop the stored token.
- Panel PIN accepts the config PIN only when `room.panelAcceptsConfigPin`
  is true (default false).
- Host binary argv is allowlisted; driver payload is not unsanitised argv.
- `.gitignore` covers `.grok/`, `.vercel/`, secrets, `node_modules`, `.env`.
- `KNOWN_ISSUES.md` only lists issues that still exist.
- No new defects opened to close old ones.

# Phases (one per turn)

## Phase 0 — inventory, no edits

List start scripts and ports; product imports of `src/lib/db.ts` / Better Auth;
failing tests by name; `.gitignore` gaps. Do not edit.

## Phase 1 — boundary

- `.gitignore`: `.grok/`, `.vercel/`, `.env`, `.env.*`, OS junk.
- Remove unused product imports of db/auth. If unused after grep, drop
  `better-auth`, `@electric-sql/pglite`, `kysely`, `pg` and refresh the lockfile.
- Align README with package.json. One port table. Prefer 8081 for
  `start`/`preview` (LINUX.md). `dev` may stay on 8080 if the preview host
  requires it — say so in the table. No raw `npx vite` in docs.
- Fix README spelling (“integration”) if present.
- Do not rename the GitHub repo from here.

Gate: `npm ci`, typecheck, test, build.

## Phase 2 — persist atomicity (issue #18)

Single persist path: temp files, fsync, rename. Use `scripts/write-atomic.mjs`
from `persistNow`. If the second write fails, the previous pair stays and the
save returns failure (dirty flag remains). Test that. Do not change on-disk
schema except a generation counter if required.

Gate: persist test + existing suite.

## Phase 3 — session and PIN trust (issue #17)

- Do not put raw session secrets in room export or `/api/room`.
- Forget / `revokeSession` must make the panel delete its stored token.
- Panel unlock accepts config PIN only if `room.panelAcceptsConfigPin === true`
  (default false).
- Expired sessions deleted from memory and secrets on sight.

Tests: Forget clears client key; config PIN rejected when flag is false;
expired token rejected.

Gate: typecheck, test, build. Panel Forget check.

## Phase 4 — control plane tests (issue #20)

Add tests beside `scripts/control-security.test.mjs`:

- HMAC: good sig; replay; uppercase hex rejected; empty key rejected;
  skew > 90s rejected; wrong path rejected.
- `allowLanControl`: off + no token → deny; off + panel token → allow
  fireMacro/fireCommand; on + no token → those three only.
- `system.restart|update|reboot` denied without config token even when open
  LAN is on.
- Trigger `change` fires once per edge; `interval` may re-fire. Empty schedule
  days: test current documented behaviour; do not silently change it.

Extract the minimum from `actions.ts` / `store.server.ts` if that is what makes
them testable. Do not mock the whole engine.

Gate: name every new test file in the phase report.

## Phase 5 — engine safety (no new transports)

In `engine.ts` / `sendLocal` only:

- `allowedLanHost` stays deny-by-default. Do not allow “any hostname.”
- GPIO / i2c / ir / cec / spi: allowlisted argv (chip, line, bus, address
  regex, scancode charset). No `payload.split` into raw argv.
- Keep connect-write-close. Do not “fix” issue #4 this pass. One comment at
  the send site pointing at `KNOWN_ISSUES.md` #4.

Gate: typecheck, build, `npm run driver:check -- data/drivers/samsung-qe50q65t.json`.

## Phase 6 — docs match the code

- `KNOWN_ISSUES.md` only still-true bullets.
- `SECURITY.md` matches Phase 3 PIN rules.
- CHANGELOG: one factual section.
- Keep the AI-generated disclaimer until a human review actually happens.

## Phase 7 — stop

Scorecard against “Definition of done”: PASS/FAIL per line, with evidence.
No extra work.

# How you work

- Read a file before you patch it.
- Prefer extract-function over copy-paste.
- One retry on the same error, then stop and ask.
- One phase per turn unless the operator names two consecutive already-green
  phases.

# Kickoff (operator pastes one line)

```text
Execute Phase 0 only. Inventory. No file writes. Then wait.
```

```text
Execute Phase 1 only. Stop on red gates. Do not start Phase 2.
```
