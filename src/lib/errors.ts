/**
 * Errors the API returns on purpose. The error handler turns each one into an
 * RFC 9457 Problem Details response; anything else becomes a generic 500.
 */

const PROBLEMS_DOC = 'https://github.com/bakirsobashy/kursi/blob/main/docs/problems.md';

/** The `type` URI of a problem: a heading in docs/problems.md, so each error documents itself. */
export const problemType = (slug: string) => `${PROBLEMS_DOC}#${slug}`;

export interface ProblemOptions {
  /** The heading slug in docs/problems.md, such as `event-sold-out`. */
  slug?: string;
  /** Short and the same for every occurrence of this problem. */
  title?: string;
  /** Specific to this occurrence, safe to show to the caller. */
  detail?: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;

  constructor(
    status: number,
    { slug, title, detail }: Required<Pick<ProblemOptions, 'slug' | 'title'>> & ProblemOptions,
  ) {
    super(detail ?? title);
    this.name = new.target.name;
    this.status = status;
    this.type = problemType(slug);
    this.title = title;
    this.detail = detail;
  }
}

export class NotFoundError extends AppError {
  constructor(options: ProblemOptions = {}) {
    super(404, { slug: 'not-found', title: 'Resource not found', ...options });
  }
}

export class ConflictError extends AppError {
  constructor(options: ProblemOptions = {}) {
    super(409, { slug: 'conflict', title: 'Conflict with the current state', ...options });
  }
}

export class UnauthorizedError extends AppError {
  constructor(options: ProblemOptions = {}) {
    super(401, { slug: 'unauthorized', title: 'Authentication required', ...options });
  }
}

export class ForbiddenError extends AppError {
  constructor(options: ProblemOptions = {}) {
    super(403, { slug: 'forbidden', title: 'Not allowed', ...options });
  }
}
