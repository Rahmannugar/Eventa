# eventa-app

Eventa's React application serves attendees and event organizers from one web experience.

Attendees use it to discover events, manage their accounts, buy tickets, and access their tickets. Organizers use the Admin Dashboard routes to manage events and understand their performance. These experiences share one application while keeping attendee and admin authentication separate.

## Build and preview

Eventa runs on a dedicated host. Build the web app with the API Gateway origin and Stripe publishable key for that host:

```bash
VITE_API_BASE_URL=https://your-eventa-host.example \
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key \
pnpm --dir apps/eventa-app build
```

Deploy `apps/eventa-app/dist` behind the host's HTTPS preview proxy. The proxy serves the SPA and forwards JSON requests to the API Gateway; its origin must match the Gateway's `CLIENT_ORIGIN`. The publishable key is a public browser value; Stripe secret keys stay in Commerce Service configuration and must never be included in a web build.

Workstation checks are lint, type checking, and production build only; do not start the Eventa stack on a workstation.

## Authentication

Attendee routes cover account creation, email verification, sign-in, password recovery, discovery, event details, ticket selection, payment, issued tickets, interests, sign-out, and password-confirmed account deletion.

Organizer routes cover approved-account activation, sign-in, password recovery, session restoration, and sign-out. Activation never creates a session; organizers sign in explicitly after activation.

## Authentication boundary

- Attendee routes use the attendee session cookie.
- Admin routes use the separate admin session cookie.
- Requests include browser credentials and go only through the API Gateway.
- The app never stores raw session tokens or calls Identity Service directly.

See [DESIGN.md](DESIGN.md) for the visual and interaction direction.
