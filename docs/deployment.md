# Deploying Kursi

Notes for running the API anywhere other than your own machine.

## Secrets

- Generate `JWT_ACCESS_SECRET` for each environment and never reuse the example value:
  `node -e "console.log(crypto.randomBytes(48).toString('base64url'))"`.
- Set `NODE_ENV=production`. It makes the refresh cookie `Secure`, so it's only sent over HTTPS, and switches the logs to JSON.

## Behind a proxy: `TRUST_PROXY`

The rate limits count requests per client IP. Behind a reverse proxy or load balancer (nginx, Caddy, a cloud load balancer), every request reaches the app from the proxy's address. The real client IP arrives in the `X-Forwarded-For` header instead.

`TRUST_PROXY` tells Express how far to trust that header. It must match your setup exactly:

| Setup                                           | `TRUST_PROXY` | What goes wrong if it's wrong                                                                |
| ----------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| No proxy (local, or the app faces the internet) | unset         | Set anyway: any client can fake `X-Forwarded-For` and dodge every rate limit                 |
| One proxy in front (the usual case)             | `1`           | Unset: every client shares the proxy's IP, so one attacker's failed logins lock out everyone |
| Two proxies (a CDN, then a load balancer)       | `2`           |                                                                                              |
| A proxy on the same machine                     | `loopback`    |                                                                                              |

The value can be a hop count, `true`, or anything Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting accepts, such as a subnet.

## CORS

`CORS_ORIGINS` lists the browser origins allowed to call the API with credentials (the refresh cookie), for example `https://kursi.app`. A request from any other origin gets no CORS headers, so the browser blocks the page from reading the response.

## Database

- Every connection sets `statement_timeout` to 5 seconds and `idle_in_transaction_session_timeout` to 10 seconds. A slow query, or a transaction left open by a bug, can't hold a connection or a row lock for long.
- Run `node dist/db/setup.js` before starting a new version of the API. It applies the migrations. It adds the demo data only when `SEED_DEMO_DATA=true`, which a real deployment never sets: the demo accounts' password is public.

## The Docker image

The `Dockerfile` builds the image that `docker compose up` runs, and it's the same image for a real deployment.

- It holds the compiled JavaScript, the production dependencies, the migrations and the docs page. No TypeScript sources, tests or dev tools.
- It runs as the unprivileged `node` user, in production mode, and listens on `PORT` (3000 by default).
- `HEALTHCHECK` calls `/health` every 10 seconds. Point a load balancer at `/ready` instead: it also checks the database.
- Prepare the database with the same image before starting the API: `docker run --rm --env-file prod.env kursi node dist/db/setup.js`.

## Shutting down

On `SIGTERM` or `SIGINT`, the API stops accepting connections, waits up to 10 seconds for requests in progress to finish, closes the database pool, and exits with code 0. Give it at least that long before a hard kill (Docker's default is 10 seconds; raise it with `stop_grace_period`).
