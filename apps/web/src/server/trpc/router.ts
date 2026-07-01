import { router } from './init';
import { authRouter } from './routers/auth';
import { baseRouter } from './routers/base';
import { cellRouter } from './routers/cell';
import { fieldRouter } from './routers/field';
import { historyRouter } from './routers/history';
import { memberRouter } from './routers/member';
import { recordRouter } from './routers/record';
import { shareRouter } from './routers/share';
import { tableRouter } from './routers/table';
import { viewRouter } from './routers/view';
import { workspaceRouter } from './routers/workspace';

export const appRouter = router({
  auth: authRouter,
  workspace: workspaceRouter,
  base: baseRouter,
  table: tableRouter,
  view: viewRouter,
  field: fieldRouter,
  record: recordRouter,
  cell: cellRouter,
  history: historyRouter,
  share: shareRouter,
  member: memberRouter,
});

export type AppRouter = typeof appRouter;
