// GET /api/v1/openapi.json — machine-readable description of the agent REST
// surface (ADR-0010). Hand-maintained next to the route files on purpose:
// the surface is small and stability matters more to agent tooling than
// auto-generation convenience. The common Bearer/Ratelimit/Error envelope is
// factored into components; per-endpoint auth is identical for all of them.
import { FIELD_TYPES } from '@/lib/field-types';
import { jsonOk } from '@/server/agent-access/http';

const errorResponse = {
  description: 'Error envelope',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
};

const okJson = (schemaRef: string) => ({
  description: 'Success',
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});

const jsonBody = (schemaRef: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});

const pathId = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description,
});

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'markpocket agent API',
    version: '1.0.0',
    description:
      'REST surface for AI agents and scripts. Auth: `Authorization: Bearer mpk_…` (personal API token, acts as its creator — every request intersects current base membership and role with the token’s base and read/write scope; expired or revoked tokens return 401, scope violations return 403; base-bound tokens cannot create bases). Rate limit: 120 requests/minute/token (429 on breach). Errors: `{ "error": { "code", "message" } }`. Mutations are also available as MCP tools at /api/mcp.',
  },
  servers: [{ url: '/' }],
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
        required: ['error'],
      },
      Base: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          icon: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Table: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          baseId: { type: 'string' },
          name: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Field: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tableId: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          options: {},
        },
      },
      View: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tableId: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
          options: {},
        },
      },
      RecordList: {
        type: 'object',
        description:
          'groups mirrors the grid UI grouping; flat records are groups[0].records when no group is configured.',
        properties: {
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                records: { type: 'array', items: { $ref: '#/components/schemas/Record' } },
              },
            },
          },
          total: { type: 'integer' },
        },
      },
      Record: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          cells: {
            type: 'object',
            description: 'fieldId → stored value. Absent key = empty cell.',
            additionalProperties: true,
          },
        },
      },
      RecordWithCellErrors: {
        type: 'object',
        properties: {
          record: { $ref: '#/components/schemas/Record' },
          cellErrors: {
            type: 'object',
            description: 'fieldId → rejection message for cells that did not store.',
            additionalProperties: { type: 'string' },
          },
        },
      },
      CellsMap: {
        type: 'object',
        description: 'fieldId → raw value (normalized per field type).',
        additionalProperties: true,
      },
      Ok: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      },
      BaseCreateInput: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
      },
      TableCreateInput: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
      },
      FieldCreateInput: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: {
            type: 'string',
            enum: [...FIELD_TYPES],
            description: 'Available types depend on the instance’s field-type registry.',
          },
          options: { type: 'object', additionalProperties: true },
        },
      },
      FieldPatchInput: {
        type: 'object',
        description: 'At least one of name/options is required.',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          options: { type: 'object', additionalProperties: true },
        },
      },
      ViewCreateInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['grid'] },
        },
      },
      ViewPatchInput: {
        type: 'object',
        description:
          'At least one of name/options is required. options = {filter?, sort?, group?, hiddenFields?}.',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          options: { type: 'object', additionalProperties: true },
        },
      },
      RecordCreateInput: {
        type: 'object',
        properties: { cells: { $ref: '#/components/schemas/CellsMap' } },
      },
      RecordPatchInput: {
        type: 'object',
        required: ['cells'],
        properties: { cells: { $ref: '#/components/schemas/CellsMap' } },
      },
    },
    securitySchemes: {
      bearerToken: { type: 'http', scheme: 'bearer', bearerFormat: 'mpk_' },
    },
  },
  security: [{ bearerToken: [] }],
  paths: {
    '/api/v1/bases': {
      get: {
        summary: 'List bases the token user belongs to',
        responses: { 200: okJson('#/components/schemas/Base') },
      },
      post: {
        summary: 'Create a base',
        requestBody: jsonBody('#/components/schemas/BaseCreateInput'),
        responses: { 201: okJson('#/components/schemas/Base'), 400: errorResponse },
      },
    },
    '/api/v1/bases/{baseId}': {
      parameters: [pathId('baseId', 'Base id')],
      get: {
        summary: 'Get one base',
        responses: { 200: okJson('#/components/schemas/Base'), 404: errorResponse },
      },
      patch: {
        summary: 'Rename a base',
        requestBody: jsonBody('#/components/schemas/BaseCreateInput'),
        responses: { 200: okJson('#/components/schemas/Base'), 400: errorResponse },
      },
      delete: {
        summary: 'Delete a base (owner)',
        responses: { 200: okJson('#/components/schemas/Ok'), 404: errorResponse },
      },
    },
    '/api/v1/bases/{baseId}/tables': {
      parameters: [pathId('baseId', 'Base id')],
      get: { summary: 'List tables', responses: { 200: okJson('#/components/schemas/Table') } },
      post: {
        summary: 'Create a table (ships with a default Grid view)',
        requestBody: jsonBody('#/components/schemas/TableCreateInput'),
        responses: { 201: okJson('#/components/schemas/Table'), 400: errorResponse },
      },
    },
    '/api/v1/tables/{tableId}': {
      parameters: [pathId('tableId', 'Table id')],
      patch: {
        summary: 'Rename a table',
        requestBody: jsonBody('#/components/schemas/TableCreateInput'),
        responses: { 200: okJson('#/components/schemas/Table'), 400: errorResponse },
      },
      delete: {
        summary: 'Delete a table (owner)',
        responses: { 200: okJson('#/components/schemas/Ok'), 404: errorResponse },
      },
    },
    '/api/v1/tables/{tableId}/fields': {
      parameters: [pathId('tableId', 'Table id')],
      get: {
        summary: 'List fields in UI order',
        responses: { 200: okJson('#/components/schemas/Field') },
      },
      post: {
        summary: 'Create a field',
        requestBody: jsonBody('#/components/schemas/FieldCreateInput'),
        responses: { 201: okJson('#/components/schemas/Field'), 400: errorResponse },
      },
    },
    '/api/v1/fields/{fieldId}': {
      parameters: [pathId('fieldId', 'Field id')],
      patch: {
        summary: 'Rename a field and/or replace its options',
        requestBody: jsonBody('#/components/schemas/FieldPatchInput'),
        responses: { 200: okJson('#/components/schemas/Ok'), 400: errorResponse },
      },
      delete: {
        summary: 'Delete a field',
        responses: { 200: okJson('#/components/schemas/Ok'), 404: errorResponse },
      },
    },
    '/api/v1/tables/{tableId}/views': {
      parameters: [pathId('tableId', 'Table id')],
      get: { summary: 'List views', responses: { 200: okJson('#/components/schemas/View') } },
      post: {
        summary: 'Create a view (grid)',
        requestBody: jsonBody('#/components/schemas/ViewCreateInput'),
        responses: { 201: okJson('#/components/schemas/View'), 400: errorResponse },
      },
    },
    '/api/v1/views/{viewId}': {
      parameters: [pathId('viewId', 'View id')],
      patch: {
        summary: 'Rename a view and/or replace its options (filter/sort/group/hiddenFields)',
        requestBody: jsonBody('#/components/schemas/ViewPatchInput'),
        responses: { 200: okJson('#/components/schemas/Ok'), 400: errorResponse },
      },
      delete: {
        summary: 'Delete a view',
        responses: { 200: okJson('#/components/schemas/Ok'), 404: errorResponse },
      },
    },
    '/api/v1/tables/{tableId}/records': {
      parameters: [pathId('tableId', 'Table id')],
      get: {
        summary: 'List records (optionally through a saved view’s filter/sort/group)',
        parameters: [
          { name: 'viewId', in: 'query', schema: { type: 'string' } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
          },
        ],
        responses: { 200: okJson('#/components/schemas/RecordList') },
      },
      post: {
        summary: 'Create a record with optional cells',
        requestBody: jsonBody('#/components/schemas/RecordCreateInput'),
        responses: { 201: okJson('#/components/schemas/RecordWithCellErrors'), 400: errorResponse },
      },
    },
    '/api/v1/records/{recordId}': {
      parameters: [pathId('recordId', 'Record id')],
      get: {
        summary: 'Get one record',
        responses: { 200: okJson('#/components/schemas/Record'), 404: errorResponse },
      },
      patch: {
        summary: 'Update cells of a record',
        requestBody: jsonBody('#/components/schemas/RecordPatchInput'),
        responses: { 200: okJson('#/components/schemas/RecordWithCellErrors'), 400: errorResponse },
      },
      delete: {
        summary: 'Delete a record',
        responses: { 200: okJson('#/components/schemas/Ok'), 404: errorResponse },
      },
    },
  },
} as const;

export async function GET() {
  return jsonOk(spec);
}
