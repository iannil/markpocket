import { router } from './init';
import { authRouter } from './routers/auth';
import { todoRouter } from './routers/todo';

export const appRouter = router({
  auth: authRouter,
  todo: todoRouter,
});

export type AppRouter = typeof appRouter;
