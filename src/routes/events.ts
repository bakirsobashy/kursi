import { Router } from 'express';
import { authenticate, authenticateIfPresent, currentUser } from '../middleware/authenticate.js';
import {
  createEventBody,
  eventParams,
  listEventsQuery,
  pagination,
  updateEventBody,
} from '../schemas/events.js';
import * as events from '../services/events.js';

export const eventsRouter = Router();

eventsRouter.get('/', async (req, res) => {
  res.json(await events.listEvents(listEventsQuery.parse(req.query)));
});

eventsRouter.post('/', authenticate, async (req, res) => {
  const event = await events.createEvent(createEventBody.parse(req.body), currentUser(req));
  res.status(201).location(`/api/v1/events/${event.id}`).json(event);
});

eventsRouter.get('/:id', authenticateIfPresent, async (req, res) => {
  const { id } = eventParams.parse(req.params);
  res.json(await events.getEvent(id, req.user));
});

eventsRouter.patch('/:id', authenticate, async (req, res) => {
  const { id } = eventParams.parse(req.params);
  res.json(await events.updateEvent(id, updateEventBody.parse(req.body), currentUser(req)));
});

eventsRouter.post('/:id/publish', authenticate, async (req, res) => {
  const { id } = eventParams.parse(req.params);
  res.json(await events.publishEvent(id, currentUser(req)));
});

eventsRouter.post('/:id/cancel', authenticate, async (req, res) => {
  const { id } = eventParams.parse(req.params);
  res.json(await events.cancelEvent(id, currentUser(req)));
});

eventsRouter.get('/:id/bookings', authenticate, async (req, res) => {
  const { id } = eventParams.parse(req.params);
  res.json(await events.listAttendees(id, currentUser(req), pagination.parse(req.query)));
});
