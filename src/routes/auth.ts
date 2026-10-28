import { Router } from 'express';
import { loginBody, registerBody } from '../schemas/auth.js';
import * as auth from '../services/auth.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const user = await auth.register(registerBody.parse(req.body));
  res.status(201).location('/api/v1/users/me').json(user);
});

authRouter.post('/login', async (req, res) => {
  res.json(await auth.login(loginBody.parse(req.body)));
});
