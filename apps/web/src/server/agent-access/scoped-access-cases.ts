// Test-only operation catalog. Coverage checks compare these entries with the
// actual REST exports and MCP registry, so new endpoints must join the matrix.
import type { Role } from '@/lib/roles';

export type ResourceIds = {
  baseId: string;
  tableId: string;
  fieldId: string;
  viewId: string;
  recordId: string;
};
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Route = (request: Request, context: { params: Promise<ResourceIds> }) => Promise<Response>;
export interface AccessCase {
  tool?: string;
  method: Method;
  path: string;
  role: Role;
  params?: keyof ResourceIds;
  body?: (ids: ResourceIds) => Record<string, unknown>;
}
const name = () => ({ name: 'Changed' });
export const ACCESS_CASES: AccessCase[] = [
  { tool: 'list_bases', method: 'GET', path: 'bases', role: 'viewer' },
  // Base creation is account-level; the runner requires all-base/write, independent of existing Base role.
  { tool: 'create_base', method: 'POST', path: 'bases', role: 'editor', body: name },
  { method: 'GET', path: 'bases/[baseId]', role: 'viewer', params: 'baseId' },
  {
    tool: 'update_base',
    method: 'PATCH',
    path: 'bases/[baseId]',
    role: 'editor',
    params: 'baseId',
    body: name,
  },
  {
    tool: 'delete_base',
    method: 'DELETE',
    path: 'bases/[baseId]',
    role: 'owner',
    params: 'baseId',
  },
  {
    tool: 'list_tables',
    method: 'GET',
    path: 'bases/[baseId]/tables',
    role: 'viewer',
    params: 'baseId',
  },
  {
    tool: 'create_table',
    method: 'POST',
    path: 'bases/[baseId]/tables',
    role: 'editor',
    params: 'baseId',
    body: name,
  },
  {
    tool: 'update_table',
    method: 'PATCH',
    path: 'tables/[tableId]',
    role: 'editor',
    params: 'tableId',
    body: name,
  },
  {
    tool: 'delete_table',
    method: 'DELETE',
    path: 'tables/[tableId]',
    role: 'owner',
    params: 'tableId',
  },
  {
    tool: 'list_fields',
    method: 'GET',
    path: 'tables/[tableId]/fields',
    role: 'viewer',
    params: 'tableId',
  },
  {
    tool: 'create_field',
    method: 'POST',
    path: 'tables/[tableId]/fields',
    role: 'editor',
    params: 'tableId',
    body: () => ({ name: 'Added', type: 'text' }),
  },
  {
    tool: 'update_field',
    method: 'PATCH',
    path: 'fields/[fieldId]',
    role: 'editor',
    params: 'fieldId',
    body: () => ({ name: 'Changed', options: {} }),
  },
  {
    tool: 'delete_field',
    method: 'DELETE',
    path: 'fields/[fieldId]',
    role: 'editor',
    params: 'fieldId',
  },
  {
    tool: 'list_views',
    method: 'GET',
    path: 'tables/[tableId]/views',
    role: 'viewer',
    params: 'tableId',
  },
  {
    tool: 'create_view',
    method: 'POST',
    path: 'tables/[tableId]/views',
    role: 'editor',
    params: 'tableId',
    body: name,
  },
  {
    tool: 'update_view',
    method: 'PATCH',
    path: 'views/[viewId]',
    role: 'editor',
    params: 'viewId',
    body: () => ({ name: 'Changed', options: { hiddenFields: [] } }),
  },
  {
    tool: 'delete_view',
    method: 'DELETE',
    path: 'views/[viewId]',
    role: 'editor',
    params: 'viewId',
  },
  {
    tool: 'list_records',
    method: 'GET',
    path: 'tables/[tableId]/records',
    role: 'viewer',
    params: 'tableId',
  },
  {
    tool: 'get_record',
    method: 'GET',
    path: 'records/[recordId]',
    role: 'viewer',
    params: 'recordId',
  },
  {
    tool: 'create_record',
    method: 'POST',
    path: 'tables/[tableId]/records',
    role: 'editor',
    params: 'tableId',
    body: (ids) => ({ cells: { [ids.fieldId]: 'Changed' } }),
  },
  {
    tool: 'update_record',
    method: 'PATCH',
    path: 'records/[recordId]',
    role: 'editor',
    params: 'recordId',
    body: (ids) => ({ cells: { [ids.fieldId]: 'Changed' } }),
  },
  {
    tool: 'delete_record',
    method: 'DELETE',
    path: 'records/[recordId]',
    role: 'editor',
    params: 'recordId',
  },
];

export async function loadRestRoutes(): Promise<Record<string, Partial<Record<Method, Route>>>> {
  return {
    bases: await import('@/app/api/v1/bases/route'),
    'bases/[baseId]': await import('@/app/api/v1/bases/[baseId]/route'),
    'bases/[baseId]/tables': await import('@/app/api/v1/bases/[baseId]/tables/route'),
    'tables/[tableId]': await import('@/app/api/v1/tables/[tableId]/route'),
    'tables/[tableId]/fields': await import('@/app/api/v1/tables/[tableId]/fields/route'),
    'fields/[fieldId]': await import('@/app/api/v1/fields/[fieldId]/route'),
    'tables/[tableId]/views': await import('@/app/api/v1/tables/[tableId]/views/route'),
    'views/[viewId]': await import('@/app/api/v1/views/[viewId]/route'),
    'tables/[tableId]/records': await import('@/app/api/v1/tables/[tableId]/records/route'),
    'records/[recordId]': await import('@/app/api/v1/records/[recordId]/route'),
  };
}
