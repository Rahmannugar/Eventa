# Eventa Web Design

## Direction

Eventa uses a warm, clear visual system built around event discovery and management. Authentication is direct and legible. Product copy explains what attendees and organizers can do without abstract marketing language.

Authrail informs the split authentication canvas, restrained controls, explicit states, and route-level session boundaries. Eventa does not reuse Authrail branding, copy, or source.

## Visual Language

- Warm parchment is the primary canvas. Deep evergreen provides structure and authority.
- Persimmon marks moments of action and energy. It is an accent, not a large background.
- Display headings use a restrained editorial serif stack. Controls and body copy use the system sans-serif stack for clarity and reliable local rendering.
- Soft 12–24px corners belong to cards and controls. Ticket-stub perforations and small circular marks provide event-specific character without becoming decoration everywhere.
- Shadows are low and diffuse. Borders and surface contrast carry most hierarchy.

## Actor Surfaces

- Attendee routes emphasize discovery, anticipation, and personal access.
- Admin routes emphasize operational calm, clear ownership, and controlled entry.
- One actor switch is available on public authentication pages. Protected route spaces never silently switch actor.
- Attendee and admin sessions can coexist, but neither session grants access to the other actor's routes.

## Layout

- Desktop authentication uses a two-column canvas: an event-led editorial panel and a focused form surface.
- Mobile collapses to one column, keeping brand, actor context, and the form above the fold without hiding essential navigation.
- Forms stay between 360px and 440px wide. Labels, help, validation, and actions align to one predictable vertical rhythm.
- Protected shells use a compact masthead and one clear account card until later product stories add domain navigation.

## Interaction

- Primary actions are solid evergreen. Secondary actions are quiet surfaced controls.
- Controls do not jump or lift on hover. Border, background, and text transitions communicate interaction.
- Submissions disable while pending and retain descriptive button text.
- Field validation is inline. Request failures stay in the form that owns recovery.
- Session restoration uses a stable skeleton. Dependency failures offer an explicit retry. Invalid sessions return to the correct actor login.

## Accessibility

- Body and control text maintain WCAG AA contrast.
- Every interactive element has a visible `:focus-visible` state and a minimum 44px touch target.
- Form errors connect to their fields through `aria-describedby`.
- Status and failure messages use live regions without moving focus unexpectedly.
- Password visibility controls expose an accessible name and pressed state.
- Motion respects `prefers-reduced-motion`.

## Known Unknowns

- Event photography and illustration are deferred until the event catalog establishes a real asset direction.
- Dark mode is not part of the authentication story.
