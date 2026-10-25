# Zip Packers — Design System (Master)

Source of truth for both portals. Page files in `pages/` may override specific rules.

**Direction:** apple.com-style product UI, applied with the UI/UX Pro Max priority
rules for the matched product types *Logistics/Delivery* and *Inventory & Stock
Management*. Airy light-gray canvas, large white rounded cards with no borders,
big centered type with tight tracking, pill buttons, "Learn more ›" links,
hairline dividers, traffic-light statuses, 180 ms feedback. Brand colors come
from zippackers.com and the logo.

## Tokens (see `public/css/styles.css` `:root`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000000` | page canvas |
| `--surface` | `#ffffff` | `#1d1d1f` | cards, modals |
| `--text` / `--muted` | `#1d1d1f` / `#6e6e73` | `#f5f5f7` / `#a1a1a6` | ≥ 4.5:1 on surface |
| `--line` / `--line-strong` | `#e8e8ed` / `#d2d2d7` | `#2f2f33` / `#424245` | hairlines, segmented tracks, inputs |
| `--accent` | `#124265` navy | `#4a8ad0` | primary pills, links, locations |
| `--gold` | `#ffbb00` | same | brand dot, step numbers, focus ring |
| `--nav-bg` | `rgba(18,66,101,.94)` | `rgba(29,29,31,.94)` | translucent top bar |
| `--ok` `--warn` `--info` `--danger` | green / amber / navy / red + `-soft` fills | tuned for dark | status chips, errors |

Shape: `--radius` 12, `--radius-lg` 18, `--radius-xl` 28 (modals), `--pill` 980.
Spacing `--space-1…8`: 4, 8, 12, 16, 24, 32, 48, 72 px.
Type: Inter (system fallback: SF Pro / Segoe UI). Sizes 12 / 14 / **17 base** /
19 / 24 / 32 / 48 hero; headings weight 600–700, letter-spacing −.02 to −.03em.
Motion: 180 ms, `cubic-bezier(.25,.1,.25,1)`; disabled under `prefers-reduced-motion`.

## Components

- **Top bar**: 52 px, dark translucent with blur, white brand text, gold dot or logo chip, pill buttons.
- **Buttons**: pills. Primary = navy; default = light gray; danger = soft red; `.link` = navy text with ›.
  40 px tall (44 px on ≤640 px). `aria-busy` spinner while an async action runs.
- **Segmented controls**: `.tabs` and `.seg` share one style: gray track, white active pill with soft shadow.
  Used for portal tabs and the client's date filter (All / Today / Yesterday / Date range).
- **Cards**: white, 18 px radius, no border, 32 px padding, subtle 2 px shadow (none in dark).
- **Product tiles**: centered, 140 px image, name, SKU · type, location pill. Lift 2 px on hover.
- **Status chips**: text + leading dot, semantic soft fill. Never color alone.
- **Forms**: visible `<label for>`, required marker, inline `.field-error` beside the field
  (`role=alert`, `aria-invalid`), 44 px inputs, 4 px focus halo.
- **Tables**: in `.table-wrap` (horizontal scroll on narrow screens), hairline rows, hover tint.
- **Empty states**: icon + headline + one sentence + next action, on a gray rounded panel.
- **Loading**: skeleton rows on first load; toasts are pills, auto-dismiss 3.5 s.
- **Pick list**: gray rounded rows, 96 px photo, location pill, 30 px quantity, 44 px tick-off.
- **Destructive actions**: delete order asks a confirm; delete client requires typing the name.

## Rules applied (priority order)

1. Accessibility — contrast, focus, labels, aria on icon buttons, live toasts.
2. Touch — ≥ 44 px targets on mobile, spacing, busy feedback on every submit.
3. Performance — lazy images in reserved boxes, no layout shift.
4. Style — one flat system, SVG icons only, no emoji.
5. Layout — mobile-first, no horizontal page scroll, tables scroll in their card.
6. Typography & color — 17 px base, semantic tokens only.
7. Animation — short, meaning-bearing, reduced-motion respected.
8. Forms — labels, inline errors, required markers, helper text.
9. Navigation — segmented tabs with clear active state; unread badge.

## Anti-patterns to keep out

Borders + shadows on the same card, emoji icons, placeholder-only labels, errors
only in toasts, hover-only affordances, color-only status, fixed-width layouts,
decorative motion.
