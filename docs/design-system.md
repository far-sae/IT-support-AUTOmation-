# Relay — design system reference

Single source of truth for what design tokens exist, where to use them, and
which UI primitives are available.

## Colors

### Brand

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F4F1E8` | app background |
| `ink`   | `#17160E` | primary text, primary button bg |
| `lime`  | `#C8F23A` | primary button text, accent |

### Semantic

Apply with Tailwind utility prefix: `bg-success-50`, `text-success-700`, etc.

| Token | Scale | Use |
|---|---|---|
| `success` | 50 / 600 / 700 | resolved, succeeded, healthy |
| `warn`    | 50 / 600 / 700 | sla-at-risk, degraded, MEDIUM severity |
| `danger`  | 50 / 600 / 700 | breach, failure, CRITICAL severity |
| `info`    | 50 / 600 / 700 | in-progress, neutral status |

### Ink scale (opacity-based)

| Class | Use |
|---|---|
| `text-ink`        | primary text |
| `text-ink/80`     | secondary text |
| `text-ink/70`     | tertiary text |
| `text-ink/60`     | labels, hints |
| `text-ink/50`     | very faint metadata |
| `border-ink/10`   | default border |
| `border-ink/15`   | hover border on cards |
| `bg-ink/5`        | hover row tint |

## Typography

| Class | Family | Use |
|---|---|---|
| `font-display` | Bricolage Grotesque | page titles, big numbers |
| `font-sans`    | Inter (default)     | body text |
| `font-mono`    | JetBrains Mono      | keys, IDs, timestamps |

Size scale: stick to Tailwind's defaults (`text-xs` → `text-4xl`). Avoid one-off sizes.

## Spacing + radii

| Token | Value |
|---|---|
| `rounded-xl`  | 0.875rem |
| `rounded-2xl` | 1.125rem |
| `rounded-full` | for buttons |

## Shadows

| Token | Use |
|---|---|
| `shadow-soft`  | default card (uniform, gentle) |
| `shadow-pop`   | hover state for `interactive` cards |
| `shadow-float` | modals, dropdowns |

## Motion

| Class | Duration | Easing |
|---|---|---|
| `duration-fast` | 120ms | `ease-snap` |
| `duration-base` | 200ms | `ease-snap` |
| `duration-slow` | 320ms | `ease-smooth` |

| Animation | Use |
|---|---|
| `animate-fade-in`   | page-load wrapper |
| `animate-slide-up`  | dropdowns, toasts |
| `animate-pulse-soft` | live-status indicators |

All animations honour `prefers-reduced-motion` via `motion-reduce:transition-none`.

## Primitives

| Component | File | Notes |
|---|---|---|
| `Card`        | `src/components/ui/Card.tsx` | `interactive` prop adds hover lift |
| `Button`      | `src/components/ui/Button.tsx` | `variant` + `size` + `loading` |
| `Badge`       | `src/components/ui/Badge.tsx` | `tone` ∈ neutral / success / warn / danger / info |
| `EmptyState`  | `src/components/ui/EmptyState.tsx` | dashed border + role="status" |
| `LoadingState`| `src/components/ui/EmptyState.tsx` | spinner + aria-live |
| `SkeletonRows`| `src/components/ui/EmptyState.tsx` | content-shaped pulse |
| `ErrorState`  | `src/components/ui/EmptyState.tsx` | role="alert" + retry button |
| `Field` + `TextInput` + `Select` + `TextArea` | `src/components/ui/Field.tsx` | labelled form controls |

## Accessibility checklist for new pages

- [ ] Heading hierarchy starts with `<h1>` (provided by `<Header>`)
- [ ] Every form control has a `<label>` (use `<Field label="..."><TextInput .../></Field>`)
- [ ] Interactive cards have `role="button"` + keyboard handler
- [ ] Buttons that change state have `aria-busy={isPending}` (Button does this for you when `loading` is set)
- [ ] Empty states use `<EmptyState>`, not bespoke markup
- [ ] Status text that should be announced uses `role="status"` (LoadingState) or `role="alert"` (ErrorState)
- [ ] Focus order is logical — test by tabbing through the page
- [ ] Visible focus rings on every interactive (Button + Sidebar provide; check custom)
