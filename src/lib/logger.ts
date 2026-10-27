import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * The app-wide logger. Development gets coloured one-line output through pino-pretty;
 * every other environment writes one JSON object per line, ready for a log collector.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
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
