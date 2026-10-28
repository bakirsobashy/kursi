import { Router } from 'express';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../lib/refresh-cookie.js';
import { loginBody, registerBody } from '../schemas/auth.js';
import * as auth from '../services/auth.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const user = await auth.register(registerBody.parse(req.body));
  res.status(201).location('/api/v1/users/me').json(user);
});

authRouter.post('/login', async (req, res) => {
  const { body, refreshToken } = await auth.login(loginBody.parse(req.body));
  setRefreshCookie(res, refreshToken);
  res.json(body);
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const { body, refreshToken } = await auth.refresh(readRefreshCookie(req), req.log);
    setRefreshCookie(res, refreshToken);
    res.json(body);
  } catch (error) {
    // A cookie that failed once will fail every time; tell the browser to drop it.
    clearRefreshCookie(res);
    throw error;
  }
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(readRefreshCookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
});
