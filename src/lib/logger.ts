import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * The app-wide logger. Development gets coloured one-line output through pino-pretty;
 * every other environment writes one JSON object per line, ready for a log collector.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  // Access tokens arrive in the Authorization header from this phase on, so keep them out of
  // the logs now. Phase 9 extends this list.
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
