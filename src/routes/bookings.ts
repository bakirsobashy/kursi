import { Router } from 'express';
import { authenticate, currentUser } from '../middleware/authenticate.js';
import { bookingParams } from '../schemas/bookings.js';
import * as bookings from '../services/bookings.js';

export const bookingsRouter = Router();

bookingsRouter.post('/:id/cancel', authenticate, async (req, res) => {
  const { id } = bookingParams.parse(req.params);
  res.json(await bookings.cancelBooking(id, currentUser(req)));
});
