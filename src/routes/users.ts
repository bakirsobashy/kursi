import { Router } from 'express';
import { AppError } from '../lib/errors.js';
import { authenticate, currentUser } from '../middleware/authenticate.js';
import { pagination } from '../schemas/events.js';
import { listMyBookings } from '../services/bookings.js';
import { findUserById, toUserResponse } from '../services/users.js';

export const usersRouter = Router();

usersRouter.get('/me', authenticate, async (req, res) => {
  const user = await findUserById(currentUser(req).id);
  // A token outlives its account by up to 15 minutes; after a deletion, it stops working here.
  if (!user) {
    throw new AppError('invalid-token', { detail: 'The account for this token no longer exists.' });
  }
  res.json(toUserResponse(user));
});

usersRouter.get('/me/bookings', authenticate, async (req, res) => {
  res.json(await listMyBookings(currentUser(req), pagination.parse(req.query)));
});
