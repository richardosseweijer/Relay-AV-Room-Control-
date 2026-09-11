# Pastel theme — agent roadmap

Goal: retune `html[data-theme="pastel"]` to **dusk rose** (warm black canvas, blush ivory text, dusty rose accent). Keep the dropdown name **Pastel**. Dark theme tokens stay untouched.

No new theme key. No engine / PIN / persist. Stop after each phase. `tsc` 0. **Do not push until asked.**

## 99% rules

- One file per phase unless a phase names two.
- Do not restyle the dark theme.
- Do not rename `"pastel"` in TypeScript.
- Do not add mint/sky. Girly = rose / mauve / plum / champagne on a **dark** page.
- Contrast: body text vs `--color-bg` and `--color-muted` vs `--color-bg` must stay readable at arm’s length (aim ~4.5:1). Chip fills must keep `text-fg` readable (same idea as dark sage/clay).
- After each phase you (or the operator) glance at panel + config in Pastel.

## Target tokens (phase 1 writes these)

| Token | Role | Hex |
|---|---|---|
| `--color-bg` | page | `#161018` |
| `--color-surface` | cards | `#22181e` |
| `--color-raised` | raised / header | `#2c2128` |
| `--color-fg` | body | `#f3e6ec` |
| `--color-muted` | labels | `#c9a4b0` |
| `--color-subtle` | hints | `#9a7a86` |
| `--color-border` | lines | `#3d2e36` |
| `--color-accent` | primary | `#e39aab` |
| `--color-accent-fg` | on accent | `#2a1820` |

Chip palette (phase 2): deeper dusty rose / plum / champagne / muted mauve — **not** 80% white pastels. Keep the same token names (`sage`, `clay`, `rose`, …).

## Phases

### 0 — this file
Inventory only. Stop.

Today pastel is a light cream (`#f3eee8`) in `src/styles.css` ~35–56. Components already use `bg-bg` / `text-fg` / `bg-sage` etc. `__root.tsx` theme-color meta is hardcoded dark (leave it until phase 3).

### 1 — page tokens
Edit **only** the `html[data-theme="pastel"]` block in `src/styles.css`: bg, surface, raised, fg, muted, subtle, border, accent, accent-fg as in the table. Leave steel…rose as they are. Stop. Operator checks: config text readable, not a white flash.

### 2 — chip tokens
Same block: retune `--color-steel` through `--color-rose` to dusk-rose cousins (deeper, still distinct). Do not change `COLOR_FILL` maps. Stop. Operator checks a few button colors on the panel.

### 3 — browser chrome (optional)
`src/routes/__root.tsx` `theme-color` meta: set from the active theme if cheap; otherwise skip. Do not fight PWA. Stop.

### 4 — click-test
Pastel: config tabs, PIN wall, panel buttons, slider, toast. Dark theme unchanged. `tsc` 0. Push only if asked.

## Out of scope

- A third theme
- Per-widget font colors
- Rewriting `styles.css` layout / radius / fonts

## Resume

Last finished phase: **4**. Push only if asked.
