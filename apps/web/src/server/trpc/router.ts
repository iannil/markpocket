import { pluginRouters } from '@/plugins.config';
import { router } from './init';
import { authRouter } from './routers/auth';
import { airtableImportRouter } from './routers/airtable-import';
import { baseRouter } from './routers/base';
import { cellRouter } from './routers/cell';
import { exportRouter } from './routers/export';
import { formRouter } from './routers/form';
import { fieldRouter } from './routers/field';
import { historyRouter } from './routers/history';
import { inviteRouter } from './routers/invite';
import { memberRouter } from './routers/member';
import { publicShareRouter } from './routers/public-share';
import { recordRouter } from './routers/record';
import { shareRouter } from './routers/share';
import { tableRouter } from './routers/table';
import { tokenRouter } from './routers/token';
import { viewRouter } from './routers/view';
import { workspaceRouter } from './routers/workspace';

export const appRouter = router({
  auth: authRouter,
  airtableImport: airtableImportRouter,
  workspace: workspaceRouter,
  base: baseRouter,
  table: tableRouter,
  view: viewRouter,
  field: fieldRouter,
  form: formRouter,
  record: recordRouter,
  cell: cellRouter,
  export: exportRouter,
  history: historyRouter,
  invite: inviteRouter,
  share: shareRouter,
  member: memberRouter,
  publicShare: publicShareRouter,
  token: tokenRouter,
  ...pluginRouters,
});

export type AppRouter = typeof appRouter;
