import { cache } from 'react';

import { appRouter } from './router';
import { createContext } from './init';

// Server-side caller for use in RSC / route handlers. Wrapped in React
// `cache()`: generateMetadata, layouts and the page of one request otherwise
// each build their own caller (and re-resolve the session from the headers);
// cache() dedupes both within a single request only.
export const api = cache(async () => {
  return appRouter.createCaller(await createContext());
});
