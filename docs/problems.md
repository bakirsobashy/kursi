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

**401.** The request needs a valid access token in an `Authorization: Bearer <token>` header. The token may be missing, expired or invalid.

## Forbidden

**403.** You are logged in, but not allowed to do this.

## Not found

**404.** The resource doesn't exist, or you aren't allowed to know it exists.

## Route not found

**404.** No endpoint matches this method and path. Check the path, including the `/api/v1` prefix, and the HTTP method.

## Conflict

**409.** The request clashes with the resource's current state. The `detail` field says how.

## Internal error

**500.** Something failed on the server. The response carries no internal details; the full error is logged under the same `requestId`.

## Not ready

**503.** Returned by `GET /ready` when the API can't reach its database. The process is running, but it can't serve requests yet. Load balancers and orchestrators should hold traffic back and check again.
