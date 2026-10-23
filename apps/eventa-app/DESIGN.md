# Eventa Web Design

## Existing Design Language

Eventa uses a warm, clear visual system built around event discovery and management. Authentication is direct and legible. Interface copy names the immediate user action.

Authrail informs the split authentication canvas, restrained controls, explicit states, and route-level session boundaries. Eventa does not reuse Authrail branding, copy, or source.

The signed-in attendee experience starts with discovery, then leads from search and recommendations to a published event, ticket selection, checkout, and issued tickets. The organizer dashboard keeps its event-management and analytics workflows in a responsive sidebar layout. Search results contain text, time, categories, and venue; published event detail supplies media, while the authoritative ticket catalogue is a separate authenticated request.

## Intended Application Direction

The owner chose Tailwind for the web overhaul, shadcn/ui for interaction primitives, and Phosphor icons. Component styling belongs in Tailwind utility classes rather than separate CSS files; the single Tailwind entry contains framework imports and shared theme tokens. The profile menu uses shadcn's accessible dropdown and Phosphor symbols.

The owner's live review of the first deployed overhaul requires a simpler shell and a responsive event page. The attendee sidebar carries Discover, Find events, and My tickets; Account moves into a top-right profile menu with Settings and Sign out. Remove repeated brand/context labels in the top bar and sidebar. The profile control is an icon with an accessible name. Light and dark appearance are both supported with a visible preference control, persisted per browser and initialized from the system preference. The event page must stack content and ticket choices before its text is squeezed into narrow columns. Use the existing orange ticket brand mark for the favicon.

Keep page headings direct. Do not put small uppercase slogans or category strings above them. On event details, categories sit below the event title as quiet tags. Events without an uploaded cover use one shared web-app photo; an actual uploaded cover always takes precedence. Attendee search and event details include maps for events whose venues have coordinates, and the organizer's venue picker remains an editable map.

Eventa should feel like a place to choose and attend events. Keep its warm parchment, evergreen, and persimmon identity, but make the signed-in experience more structured and less ornamental: a clear attendee navigation shell, a focused home for discovery, a scannable catalogue with entire cards linking to event details, and an event page where the schedule, venue, description, imagery when available, and ticket choices lead naturally into checkout. Use editorial type for event titles and compact sans-serif labels for time, place, and actions. When an event has no cover, use a deliberate typographic card surface without pretending an image exists.

The attendee navigation reflects working destinations. Discover and Account exist first; For you, My tickets, and purchase-result destinations become visible when their real routes are connected. Account settings keep sign-out and deletion accessible without making them the signed-in home. The organizer shell keeps its own actor boundary, event-management tools, and analytics, while sharing the same spacing, type hierarchy, focus treatment, and responsive navigation discipline.

Consumel's list-to-detail hierarchy and Macro Terminal's persistent desktop navigation, compact mobile drawer, and purposeful home composition are references for interaction quality only. Authrail remains a reference for disciplined application states and focus behaviour. Eventa derives its own labels, content, visual identity, and workflow from its actors and contracts; none of these projects supplies Eventa components or copy.

Desktop uses a persistent navigation area and a compact page header around a centered working canvas. Narrow widths use a visible menu control and closable drawer, with navigation and sign-out still reachable by keyboard. Repeated event cards have one unambiguous link target, a visible focus state, and no nested action conflict. Event details keep ticket selection near the purchase action; checkout shows a stable order state and recoverable payment path. Loading, empty, error, pending, sold-out, and success states are distinct and literal.

## Product Language

- Write for attendees and organizers, not for developers. Interface copy never exposes service names, API or database fields, transport mechanics, internal versions, source-of-truth terminology, implementation status, delivery slices, or missing backend capabilities.
- Translate system state into what happened, what it means to the user, and the next available action. Use a backend term only when it is also the clearest established product concept for the actor.
- Headings identify the task or content. Labels name the information requested. Buttons name the action. Do not add subtitles, helper text, badges, empty-state prose, or recovery instructions that merely repeat visible UI or narrate how Eventa is implemented.
- Never turn a contract shape directly into screen structure or copy. The interface may collect or display the same data only after translating it into the organizer's or attendee's mental model.

## Event Management

- The Events landing route is a management list. Its header pairs the `Events` heading with the primary `Create event` action. Creation has its own route and does not replace the catalog.
- The management list keeps name search, dependent country and state or region filters, and sorting in the URL. Changing criteria starts a fresh server-side result set while retaining the preceding rows during the request.
- Wide layouts use a compact, scannable table. Narrow layouts use stacked event cards with the same information and one clear row-level navigation target.
- Selecting an event opens its details page. Details are the event's management home and present its Draft or Published state, categories, schedule, venue, cover, gallery, and available actions. Editing is a separate explicit route. Successful creation and editing return to details.
- Event creation collects the complete event and venue in one form. The venue's optional location is set by placing a pin on the map or typing latitude and longitude as a pair; the form sets or clears them together. The map draws OpenStreetMap tiles with their attribution always visible and performs no address lookup. Creation and editing share category, date-time, time-zone, and country controls so the same information never behaves differently between routes.
- Categories use a searchable multi-select with removable selections and a maximum of five. Date-time fields use Byte DatePicker v3's accessible date-time picker while Eventa retains explicit time-zone conversion. Time zones, countries, and dependent states or regions use searchable structured selections; display names remain visible while stable codes cross application boundaries.
- Catalogue search, geographic filters, sorting, and pagination are server-backed. Criteria remain visible and recoverable across navigation and responsive layouts.
- Dirty state changes action availability and protects navigation. It is not displayed as explanatory product copy. Avoid side checklists and helper panels that repeat the form. Never label a draft private or label an existing event new.

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
- Event management uses a constrained working canvas rather than a generic metric dashboard. Creation has one clear entry action. Details separate readable event information, media, and lifecycle actions from the dedicated editing form. Internal versions never appear as product content.

## Interaction

- Primary actions are solid evergreen. Secondary actions are quiet surfaced controls.
- Controls do not jump or lift on hover. Border, background, and text transitions communicate interaction.
- Submissions disable while pending and retain descriptive button text.
- Field validation is inline. Request failures stay in the form that owns recovery.
- Short-lived action outcomes use one Eventa-styled toaster at the top right. Success and error notices never replace field validation or the owning form's recoverable failure state.
- Six-digit verification and activation codes use the shared shadcn-style OTP control with paste, one-time-code autofill, visible slot focus, and no decorative separator.
- Public login pages remain usable while session restoration is pending or unavailable. A valid restored session redirects to the protected route. Protected-route restoration uses a stable loading state, offers retry on dependency failure, and returns invalid sessions to the correct actor login.
- Event drafts use explicit Save. A stale version preserves entered values, explains the conflict in the form, and requires an explicit reload before another attempt. Successful creation and saving navigate to event details after announcing the outcome; dependency and not-found failures remain in the page that owns recovery.
- Cover and gallery actions live with the media they affect. Upload, verification, replacement, removal, conflicts, and terminal recovery remain explicit without exposing storage or worker terminology.
- Publication readiness lives in the details lifecycle rail. Missing information links to the owning edit or cover action. Publishing uses a focused confirmation, and the backend rechecks readiness before the details page changes to its read-only Published state.
- Draft retirement uses deliberate confirmation and recoverable language. Published cancellation is not presented as ordinary deletion.
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
