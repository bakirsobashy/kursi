import { Router } from 'express';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';

/** Every business route, mounted under /api/v1. */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
