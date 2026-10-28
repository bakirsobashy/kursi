# Problem types

Every error response from the API is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details object with the content type `application/problem+json`. Its `type` field links to one of the headings below.

```json
{
  "type": "https://github.com/bakirsobashy/kursi/blob/main/docs/problems.md#route-not-found",
  "title": "Route not found",
  "status": 404,
  "detail": "No route matches GET /nope.",
  "instance": "/nope",
  "requestId": "6f1c9e0a-4b0e-4a8e-9a43-0c7a2f6d1e55"
}
```

- `title` is the same every time this problem happens; `detail` describes this occurrence.
- `instance` is the path that was requested, without its query string.
- `requestId` matches the response's `X-Request-Id` header and every log line for the request. Quote it when you report a problem.

## Validation failed

**400.** One or more fields in the body, query string or path are invalid. The `errors` array lists each field and what is wrong with it:

```json
"errors": [{ "path": "capacity", "message": "Too small: expected number to be >=1" }]
```

Fix the fields listed and send the request again.

## Malformed JSON

**400.** The body is not valid JSON. Check for trailing commas, single quotes and unquoted keys, and send `Content-Type: application/json`.

## Payload too large

**413.** The body is larger than 100 kB.

## Unauthorized

**401.** The request has no access token. Log in with `POST /api/v1/auth/login` and send the token in an `Authorization: Bearer <token>` header.

## Invalid token

**401.** The access token was sent but can't be used: it has expired, its signature doesn't match, or its account no longer exists. The `detail` field and the `WWW-Authenticate` header say which. After an expiry, call `POST /api/v1/auth/refresh` for a new token and retry.

## Invalid refresh token

**401.** `POST /api/v1/auth/refresh` couldn't continue the session. The cookie may be missing, unknown or expired (sessions end after 7 days without a refresh). Or it may have been used before: each refresh token works once, and a second use ends the whole session in case the token was stolen. The response also deletes the cookie. Log in again.

## Invalid credentials

**401.** The email and password don't match an account. The response is the same whether the email is unknown or the password is wrong, so it can't be used to find out who has an account.

## Email taken

**409.** `POST /api/v1/auth/register` was called with an email that already has an account. Emails are compared without regard to case, so `Ali@example.com` and `ali@example.com` are the same account. Log in instead.

## Forbidden

**403.** You are logged in, but not allowed to do this.

## Not found

**404.** The resource doesn't exist, or you aren't allowed to know it exists. For example, someone else's draft event answers 404 rather than 403, so its existence stays private.

## Route not found

**404.** No endpoint matches this method and path. Check the path, including the `/api/v1` prefix, and the HTTP method.

## Conflict

**409.** The request clashes with the resource's current state. The `detail` field says how.

## Event not draft

**409.** `POST /api/v1/events/{id}/publish` was called on an event that isn't a draft. Only drafts can be published; a published event is already live, and a cancelled one can't come back.

## Event started

**409.** The draft's start time has already passed, so it can't be published. Move `startsAt` to the future with `PATCH /api/v1/events/{id}`, then publish.

## Event cancelled

**409.** The event is cancelled, so it can't be edited or cancelled again. Cancelling is final: the event stays visible as cancelled, and its bookings are cancelled with it.

## Capacity below bookings

**409.** `PATCH /api/v1/events/{id}` tried to set `capacity` below the number of seats already booked. The `detail` field says how many are booked. The database enforces this rule itself, so it holds even when a booking arrives during the update.

## Event sold out

**409.** Every seat for the event is booked. The `detail` field gives the capacity. A seat may free up if someone cancels.

## Already booked

**409.** You already hold a confirmed seat at this event; each person can hold one. To book again, cancel the existing booking first.

## Event not bookable

**409.** The event exists but isn't taking bookings, because it's cancelled or has already started. The `detail` field says which. Drafts aren't bookable either, but they answer 404 because they aren't public.

## Internal error

**500.** Something failed on the server. The response carries no internal details; the full error is logged under the same `requestId`.

## Not ready

**503.** Returned by `GET /ready` when the API can't reach its database. The process is running, but it can't serve requests yet. Load balancers and orchestrators should hold traffic back and check again.
