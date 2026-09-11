# Drivers page — agent roadmap

Goal: Drivers tab is a **library browser**. Search + sort/filter from fields
already in every JSON (`device.manufacturer`, `device.model`, `device.type`).
**Add from library** still copies a spec into the room. Devices tab stays as-is
(dropdown of **loaded** drivers only).

No new JSON keys. No engine / PIN / persist / Devices-tab edits.

Stop at the end of every phase. Report files + `tsc`. **Do not push until asked.**

## 99% rules

- One phase = one kind of change. UI first; snapshot slimming last.
- Do not rename filenames or `device.type` values.
- Do not change `addDriverFromLibrary`, `deleteDriver`, `saveDriver` contracts
  until a phase names them.
- Do not import `*.server.ts` from the tab.
- Devices tab, macros, monitors: no edits.
- After each phase: `./node_modules/.bin/tsc --noEmit` exit 0. If red, stay here.

## Data we already have (20 bundled files)

| Index | Source | Notes |
|---|---|---|
| Brand | `spec.device.manufacturer` | 7× `Generic` — still searchable |
| Type | `spec.device.type` | `display` `projector` `amplifier` `lighting` `camera` `switcher` `source` `host` `shades` `other` |
| Model | `spec.device.model` | SKU or class name |
| File | object key | `samsung-qe50q65t.json` |

Search haystack = manufacturer + model + type + filename (+ `device.notes` if present).

## Current vs target

Today: one `<select>` of library filenames not yet in `snap.drivers`, then a
card per **loaded** driver with JSON editor.

Target:

1. Search box + type chips + sort (manufacturer, then model).
2. Library rows: `Samsung · display · QE50Q65T` → Add / In room.
3. Loaded-in-room list stays below (edit JSON / delete) — same as now.
4. Devices tab unchanged.

At 1000 files, the browser must **not** receive 1000 full specs. That is a
later phase. Phases 1–4 work on the full `snap.library` we already send.

## Shared contract

`drivers-tab.tsx` keeps: `draft`, `snap`, `token`, `flash`, `refresh`,
`driverName` / `driverText` / `pendingDriver` / `libraryPick` (or drop pick
when the list replaces the select).

## Phases

### 0 — this file
Inventory only. No code. Stop.

### 1 — search box (filter only)
In `drivers-tab.tsx` only. Local `query` state. Filter **library** names
(and loaded cards) if haystack includes query (case-insensitive). Empty query
= current list. Keep the `<select>` + Add button. Stop.

### 2 — type chips
Chips from unique `device.type` values in `snap.library` (plus All). AND with
search. No new types. Stop.

### 3 — sort
Default sort: `manufacturer` then `model` then filename. Optional toggle
filename A–Z. Same rows, different order. Stop.

### 4 — list instead of select
Replace the library `<select>` with a scrollable row list (label from
manufacturer / type / model, filename as mono hint). Each row: Add if not in
`snap.drivers`, else “In room”. Keep upload JSON + loaded editor cards.
`libraryPick` can die if unused. Stop.

### 5 — index type (no wire yet)
Add `DriverIndex = { filename, manufacturer, model, type }` in `types.ts`.
Helper `indexDriver(filename, spec)`. Unit-free: export and use it to **label**
rows (still reading full `snap.library`). Stop.

### 6 — slim library on the wire
`RoomSnapshot.library` becomes `Record<string, DriverIndex>` (or a parallel
`libraryIndex` if you must keep full specs for one release).
`addDriverFromLibrary` still loads the file on the server.
`getEditorConfig` / `/api/room` must not dump full library specs.
Loaded `snap.drivers` stays full JSON (room needs commands).
One test or grep: snapshot JSON has no `commands` under library entries.
**This is the 1000-driver phase.** Stop.

### 7 — click-test
Add, search “samsung”, chip `display`, sort, delete still blocked when in use,
Devices dropdown still only loaded names. `tsc` 0. Push only if asked.

## Out of scope (do not do in this roadmap)

- Changing `type: "other"` / `Generic` in existing JSON
- Pagination, virtual lists, cloud catalog
- Devices-tab search
- New driver schema fields (`brand`, `tags`, …)

## Resume

Last finished phase: **7** (code). Click-test on your side. Push only if asked.
