// Responses that didn't match the API docs, collected by tests/contract.ts and reported by
// tests/setup-env.ts after each test. This module imports nothing from src on purpose: the
// setup file loads it before the env variables the app reads are set.

const violations: string[] = [];

export function recordViolation(violation: string) {
  violations.push(violation);
}

/** Returns the violations recorded since the last call, and forgets them. */
export function takeViolations() {
  return violations.splice(0);
}
