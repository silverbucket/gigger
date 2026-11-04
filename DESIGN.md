# Gigger design rules (for agents)

Put this file in the repo root and reference it from CLAUDE.md. Follow these rules for every new screen; don't ask.

## Foundation

- Visual system: Modernist. `styles.css` in this folder is the single source of tokens + component classes. Port it to `web/src/styles/modernist.css` and import globally. Never hard-code hex, font or radius values.
- Font: Archivo 400/600/800. Radius: 0 everywhere. Rules: 2px `var(--color-divider)` between major sections, 1px between rows.
- Accent red (`--color-accent` #ec3013) only for: the primary action, the current nav item, the selected row marker, the next-gig block, current status step. Paragraph-size red text uses `--color-accent-700`.
- Everything flush left, including labels inside wide buttons (trailing icon pushed right).
- Icons: Lucide, 16–20px, stroke 2–2.5, `currentColor`.
- Hit targets on phone ≥ 44px.

## Layout patterns

- Desktop record screens = **list + detail pane**: list `minmax(0,1fr)`, detail 560–640px with a 2px ink left border. Selecting a row never replaces the list.
- Row selection: background `--color-neutral-200` + `inset 4px 0 0 var(--color-accent)`.
- Section label: 12px, 600, uppercase, letter-spacing .1em, with a 2px rule under it.
- Detail sections: 110px label column + content column, 1px rule between.
- Key numbers / times: grid of equal cells (stat cells), label 11px uppercase over 24–30px/800 value.
- Phone: 56px top bar, content, bottom 4-tab bar (Bookings · N, Contacts, Venues, Band) with a 4px red inset top on the active tab. Primary action sits in a bottom bar above a 2px ink rule.

## Behaviour rules

- Any field that links to a potentially large list (contacts, venues, other bands) is a **search box with ranked suggestions**; the last row is always "Create … as new". Never render all records as chips/checkboxes.
- Incoming messages: auto-pick a contact only on an exact handle/email match and show the reason ("Matched by Instagram handle"); otherwise show suggestions + "New contact from sender" prefilled from the source.
- Values extracted from messages are prefilled and labelled "Filled in from the message. Check before saving."
- Private data (earnings, take-home, fees, notes) carries a `Private` neutral tag where it's displayed.
- Status flow enquiry → offered → confirmed → played (+ cancelled from the first three) is shown as 4 equal step cells: done = ink, current = accent, todo = empty.
- Empty states are one line of plain text explaining what fills it — no illustrations.

## Adding a feature

1. Compose from existing components (see README "Components").
2. If something new is needed, add it as a component first, document it in the README components list, then use it.
3. Keep copy short, sentence case, no exclamation marks.
