import { z } from 'zod';

// Messages name the problem, never the value: a bad secret must not end up in a terminal or log.
const requiredOr = (message: string) => ({
  error: (issue: { input?: unknown }) => (issue.input === undefined ? 'is required' : message),
});
const port = 'must be a whole number from 1 to 65535';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number({ error: port }).int(port).min(1, port).max(65_535, port).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({
    ...requiredOr('must be a postgres:// URL'),
    protocol: /^postgres(ql)?$/,
  }),
  JWT_ACCESS_SECRET: z
    .string(requiredOr('must be a string'))
    .min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((list) =>
      list
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.url({ protocol: /^https?$/, error: 'must be a comma-separated list of http(s) origins' }),
      ),
    ),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid environment variables:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/** Validates a set of environment variables. Throws EnvError listing every problem at once. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map(
        (issue) => `${issue.path.at(0)?.toString() ?? 'env'}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    // The logger isn't configured yet (it needs LOG_LEVEL), so this goes straight to stderr.
    console.error(`${error.message}\nCheck your .env file against .env.example.`);
    process.exit(1);
  }
}

/** The validated config, parsed once when the app starts. */
export const env = loadEnv();
