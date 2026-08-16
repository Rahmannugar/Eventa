# Eventa Web Design

## Direction

Eventa uses a warm, clear visual system built around event discovery and management. Authentication is direct and legible. Interface copy names the immediate user action.

Authrail informs the split authentication canvas, restrained controls, explicit states, and route-level session boundaries. Eventa does not reuse Authrail branding, copy, or source.

## Product Language

- Write for attendees and organizers, not for developers. Interface copy never exposes service names, API or database fields, transport mechanics, internal versions, source-of-truth terminology, implementation status, delivery slices, or missing backend capabilities.
- Translate system state into what happened, what it means to the user, and the next available action. Use a backend term only when it is also the clearest established product concept for the actor.
- Headings identify the task or content. Labels name the information requested. Buttons name the action. Do not add subtitles, helper text, badges, empty-state prose, or recovery instructions that merely repeat visible UI or narrate how Eventa is implemented.
- Never turn a contract shape directly into screen structure or copy. The interface may collect or display the same data only after translating it into the organizer's or attendee's mental model.

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
- Authentication uses a compact signed-in attendee account landing. The Admin Dashboard uses a dedicated organizer shell with a persistent desktop sidebar and a compact mobile header. Only implemented organizer destinations appear in its navigation.
- Event management uses a constrained working canvas rather than a generic metric dashboard. Creation has one clear entry action. Editing separates the primary form from a compact step guide and keeps the authoritative event status and version visible.

## Interaction

- Primary actions are solid evergreen. Secondary actions are quiet surfaced controls.
- Controls do not jump or lift on hover. Border, background, and text transitions communicate interaction.
- Submissions disable while pending and retain descriptive button text.
- Field validation is inline. Request failures stay in the form that owns recovery.
- Short-lived action outcomes use one Eventa-styled toaster at the top right. Success and error notices never replace field validation or the owning form's recoverable failure state.
- Six-digit verification and activation codes use the shared shadcn-style OTP control with paste, one-time-code autofill, visible slot focus, and no decorative separator.
- Public login pages remain usable while session restoration is pending or unavailable. A valid restored session redirects to the protected route. Protected-route restoration uses a stable loading state, offers retry on dependency failure, and returns invalid sessions to the correct actor login.
- Event drafts use explicit Save. A stale version preserves entered values, explains the conflict in the form, and requires an explicit authoritative reload before another attempt. Success is announced without moving focus; dependency and not-found failures remain in the page that owns recovery.
- Data-backed admin routes keep the organizer shell visible while page-shaped loading, empty, error, and recovery states change inside the workspace.

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
