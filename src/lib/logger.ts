import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Values that must never reach a log line, wherever they turn up. The app doesn't log request
 * bodies, but these paths keep a secret out even if a future log call passes one in.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
];

/**
 * The app-wide logger. Development gets coloured one-line output through pino-pretty;
 * every other environment writes one JSON object per line, ready for a log collector.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: REDACTED_PATHS,
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        // The full request and response objects stay in production logs; here they are noise.
        ignore: 'pid,hostname,req,res',
      },
    },
  }),
});
