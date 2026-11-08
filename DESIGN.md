# Showday design rules (for agents)

Follow these rules for every new screen; don't ask. Calm, legible, and clear about what is public.

## Foundation

- Tokens and shared classes live in `web/src/styles/theme.css`, app layout rules in `web/src/styles/app.css`. Never hard-code hex, font or radius values in a screen; use the tokens. Every colour has a dark-mode value, so new colours go into both blocks.
- Font: Inter 400/500/600/700. Headings 600–700, body 14px, labels 13px. Sentence case everywhere; no uppercase labels.
- Ground `--color-bg`, panes and cards `--color-surface`, fills `--color-surface-2`, tracks `--color-sunken`. Hairline `--rule` (1px) between rows and sections.
- Radius: 6/8/12/16 (`--radius-sm` … `--radius-xl`), pills for tags. Soft shadows only (`--shadow-sm|md|lg`).
- Accent (warm tomato red) only for: the primary action, the current nav item, the selected row, links, focus, unread markers and the next-gig card.
- Status colours come from `--tone-<status>-bg/fg` (enquiry grey, offered amber, confirmed green, played blue, cancelled crimson). No purple anywhere; channels from `--channel-<name>`; danger from `--color-danger`.
- Icons: Lucide paths in `Icon.svelte`, 14–22px, `currentColor`.
- Hit targets on phone ≥ 44px.

## Layout patterns

- Desktop: a 232px sidebar (brand, band picker, sections, settings, account), then a 56px page bar with the screen title and its one primary action, then the screen.
- Record screens are a **list + detail pane** (`ListDetailLayout`); selecting a row never replaces the list. The Inbox uses the `inbox` variant: narrow list, wide reading pane.
- Rows are rounded, tinted on hover, `--select-bg` when selected. Group headings are `SectionLabel` (13px, muted).
- Phone: an opaque top bar (band picker, settings, new), content, and a bottom icon tab bar (Gigs, Inbox, Contacts, Venues, Band). A record opens on its own screen with a back button; its primary action sits in a sticky bottom bar.

## Messages and gigs

- A conversation is never only a step towards a gig. It lives in the Inbox (To sort, With gig, Set aside, All) and opens as a chat thread, oldest first, with the reply box pinned at the bottom.
- The context a reply needs sits beside the thread (above it on a phone): the linked gig, or what was read from the message with Add as gig / Not a booking / Discard, and the contact.
- Messages are shown with avatars and channel icons; gigs with date tiles and status tags. Don't mix the two shapes in one list.
- "Enquiry" is only a gig status. Actions say "gig": New gig, Add as gig, Save gig.

## Public and private

- Anything shown on the public page carries a `Public` tag (globe); private data (fees, earnings, notes, contacts, addresses, the gig title) carries `Private` (lock).
- Forms say up front what fans can see. Group public fields together, apart from private ones.
- Contacts and other bands are always private; say so under their headings.

## Behaviour rules

- Any field that links to a potentially large list (contacts, venues, other bands) is a **search box with ranked suggestions**; the last row is always "Create … as new". Never render all records as chips/checkboxes.
- Incoming messages: auto-pick a contact only on an exact handle/email match and show the reason ("Matched by Instagram handle"); otherwise show suggestions + a new contact prefilled from the sender.
- Values extracted from messages are prefilled and labelled "Filled in from the message. Check before saving."
- Status flow enquiry → offered → confirmed → played (+ cancelled from the first three) is shown as a four-part progress track (`StatusSteps`).
- Empty states are one line of plain text explaining what fills it, optionally with a quiet icon.

## Adding a feature

1. Compose from existing components (see README "Design system").
2. If something new is needed, add it as a component first, document it in the README components list, then use it.
3. Keep copy short, sentence case, no exclamation marks.
