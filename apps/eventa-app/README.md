# eventa-app

Eventa's React application serves attendees and event organizers from one web experience.

Attendees use it to discover events, manage their accounts, buy tickets, and access their tickets. Organizers use the Admin Dashboard routes to manage events and understand their performance. These experiences share one application while keeping attendee and admin authentication separate.

## Run locally

Create the local environment file:

```bash
cp apps/eventa-app/.env.example apps/eventa-app/.env
```

Start the app from the repository root:

```bash
pnpm web:start
```

Open `http://localhost:5273`.

The app runs on the host, not in Docker Compose. Its backend boundary is the API Gateway at `http://localhost:3004`. Configure the Gateway's `CLIENT_ORIGIN` as `http://localhost:5273`.

## Authentication boundary

- Attendee routes use the attendee session cookie.
- Admin routes use the separate admin session cookie.
- Requests include browser credentials and go only through the API Gateway.
- The app never stores raw session tokens or calls Identity Service directly.

See [DESIGN.md](DESIGN.md) for the visual and interaction direction.
