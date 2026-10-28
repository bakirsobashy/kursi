import type { AuthUser } from '../lib/tokens.js';

// Adds the user that `authenticate` attaches to every request it lets through.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
