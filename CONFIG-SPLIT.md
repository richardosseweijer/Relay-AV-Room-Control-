# Config UI split — agent roadmap

Goal: `config-app.tsx` is a shell (PIN, Save all, toast, refresh, tab bar, `draft`).
Each tab is its own file. **Same behavior.** No new features. No `saveConfig` / engine / PIN changes.

Stop at the end of every phase. Report files + `tsc`. **Do not push until asked.**

## 99% rules

- One phase = one mechanical move. If a phase needs two kinds of change, it is too big: split it.
- Copy JSX as-is. Rename nothing. Do not “clean up” class names or labels.
- Do not change `update()`, `refresh()`, `saveConfig`, session, or `/api/room`.
- Do not import `*.server.ts` from new files.
- New files only under `src/components/config/`.
- After each phase: `npx tsc --noEmit` (or `./node_modules/.bin/tsc --noEmit`) exit 0. If red, stay in that phase.
- If preview throws `reading 'room'`, revert the phase.

## Shared contract (all tab files)

Shell keeps: `token`, `snap`, `draft`, `setDraft`, `tab`, toast/lock, `refresh`, `update`.

Tabs receive only what they already use, typically:

```ts
{ draft, snap, token, update, flash }
```

`update` stays in the shell: `(mut) => setDraft(structuredClone + mut)` — same as today.

## Phases

### 0 — this file
Inventory only. No code. Stop.

Current: `config-app.tsx` ~2300 lines. Already local: `TagBar`, `InventoryBoard`, `PagesEditor`, `InputNum`, `fieldClass`. Tabs inlined in `ConfigApp`.

### 1 — shared chrome (no tab logic)
Move only what has **no ConfigApp state**:

- `fieldClass`, `COLORS`, `COLOR_FILL` → `src/components/config/config-ui.ts`
- `InputNum` → same or `config-fields.tsx`

`config-app.tsx` imports them. Zero behavior change. Stop.

### 2 — TagBar
Move `tagOf` / `tagVisible` / `tagNames` / `currentTag` / `setTags` / `fileItem` / `TagBar` → `src/components/config/tag-bar.tsx`.

`tagFilter` state stays in the shell (or moves in phase 8 with macros). Stop.

### 3 — Inventory widgets
Move `InventoryBoard` + `InventoryPicker` → `src/components/config/inventory-board.tsx`. Stop.

### 4 — PagesEditor
Move `overlaps` + `PagesEditor` → `src/components/config/pages-editor.tsx`.
Pages **tab chrome** (grid size, add page) stays in `config-app.tsx` until phase 9. Stop.

### 5 — Log tab
Smallest tab. `src/components/config/log-tab.tsx`. Move `formatAge` + `proc` state **with** the tab (poll stays in the tab). Shell still `refresh()`s snap. Stop.

### 6 — Security tab
`security-tab.tsx`. Paired-tablet list + PIN fields only. Stop.

### 7 — Room tab
`room-tab.tsx`. Version, network, update/reboot/export. Stop.

### 8 — Drivers tab
`drivers-tab.tsx`. Stop.

### 9 — Interfaces tab
`interfaces-tab.tsx`. `openIfaces` state moves with it. Stop.

### 10 — Macros tab
`macros-tab.tsx`. `openMacros` + macro `tagFilter` move with it. Stop.

### 11 — Logic tab
`logic-tab.tsx`. Variables / monitors / schedules / triggers. `logicTab` + `openLogic` move with it. Stop.

### 12 — Devices tab (last)
Largest. `devices-tab.tsx`. `openDevices`, probe timers, traces, inventory actions move with it. Do **not** combine with another phase. Stop.

### 13 — shell audit
`config-app.tsx` should be: imports, `ConfigApp` state, header, tab switch, the 9 tab components. No leftover page-grid JSX. `tsc` + you click every tab once. Stop. Push only if asked.

## Out of scope

Engine split, new config features, CSS rewrite, URL-per-tab, tests beyond `tsc` unless a phase breaks a current test.

## Resume line

Last finished phase: **13**. Split complete. Push only if asked.
