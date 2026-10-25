# Zip Packers — Design System (Master)

Source of truth for both portals. Page files in `pages/` may override specific rules.
Derived with the UI/UX Pro Max priority rules for the matched product types
*Logistics/Delivery* and *Inventory & Stock Management*: Swiss/minimal flat UI,
neutral base, traffic-light statuses, clear functional type, 150 ms feedback,
no decorative shadows. Brand colors come from zippackers.com and the logo.

## Tokens (see `public/css/styles.css` `:root`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#124265` | `#3b7ac2` | primary buttons, links, locations |
| `--gold` | `#ffbb00` | same | brand bar, active tab, notification edge, focus ring |
| `--steel` | `#5e7fa3` | `#8fa9c6` | secondary accents |
| `--text` / `--muted` | `#2b2f36` / `#5f6670` | `#e8eaf0` / `#a3acba` | 7:1 and 4.5:1+ on surface |
| `--bg` / `--surface` | `#f4f5f7` / `#fff` | `#0f1420` / `#171d2b` | page / cards |
| `--ok` `--warn` `--info` `--danger` | green / amber / navy / red + `-soft` fills | tuned for dark | status chips, errors |

Spacing scale `--space-1…7`: 4, 8, 12, 16, 24, 32, 48 px (density 7: tables use 12/8).
Type scale: 12 / 13 / **16 base** / 18 / 22 / 30 px, line-height 1.5.
Fonts: Roboto (text), Roboto Slab (headings, big pick quantities). Radius 8 / 12 px.
Motion: 150 ms, `cubic-bezier(.2,.7,.3,1)`, fully disabled under `prefers-reduced-motion`.

## Components

- **Buttons**: flat, 40 px min height (44 px on ≤640 px screens), `aria-busy` spinner while an
  async action runs. Icon-only buttons are `.icon-btn` with an `aria-label`.
- **Icons**: inline SVG from `G.icon(name)` (stroke = currentColor). Never emoji.
- **Status chips**: text + leading dot, semantic soft fill. Meaning is never color alone.
- **Forms**: visible `<label for>`, required marker, inline `.field-error` beside the field
  (`role=alert`, `aria-invalid`), 44 px inputs, focus ring in gold.
- **Tables**: inside `.table-wrap` (horizontal scroll on narrow screens), uppercase 12 px
  headers, row hover, `.cell-sub` for secondary text.
- **Empty states**: icon + bold headline + one sentence + next action.
- **Loading**: skeleton rows on first load; toasts auto-dismiss after 3.5 s (`role=status`).
- **Pick list**: 96 px photo, location in navy with pin icon, 28 px quantity, a 44 px
  checkbox per line that strikes the line through when ticked.

## Rules applied (priority order)

1. Accessibility: contrast ≥ 4.5:1, visible focus, labels, aria on icon buttons.
2. Touch: ≥ 44 px targets on mobile, 8 px+ spacing, busy feedback on every submit.
3. Performance: lazy images with reserved 56/96 px boxes (no layout shift).
4. Style: flat minimal, consistent tokens, SVG icons only.
5. Layout: mobile-first, no horizontal page scroll, tables scroll in their card.
6. Typography & color: 16 px base, semantic tokens, no raw hex in components.
7. Animation: 150 ms, meaning-bearing only, reduced-motion respected.
8. Forms: labels, inline errors, helper text, required markers.
9. Navigation: tabs with gold active state, unread badge announced via `role=status` toast.

## Anti-patterns to keep out

Decorative shadows/3D, emoji icons, placeholder-only labels, errors only in toasts,
hover-only affordances, 0 ms state changes, color-only status, fixed-width layouts.
