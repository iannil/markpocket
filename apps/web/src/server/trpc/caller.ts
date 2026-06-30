import { appRouter } from './router';
import { createContext } from './init';

// Server-side caller for use in RSC / route handlers.
export async function api() {
  return appRouter.createCaller(await createContext());
}
