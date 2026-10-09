import { describe, expect, it } from 'vitest';
import { mapValue, parseSchema, preflight, validateRecordValues } from './mapping';

const fixture = parseSchema({
  tables: [
    {
      id: 'tblPeople',
      name: 'People',
      fields: [
        { id: 'fldName', name: 'Name', type: 'singleLineText' },
        { id: 'fldActive', name: 'Active', type: 'checkbox' },
        {
          id: 'fldRole',
          name: 'Role',
          type: 'singleSelect',
          options: { choices: [{ id: 'selAdmin', name: 'Admin', color: 'blueBright' }] },
        },
        {
          id: 'fldTeam',
          name: 'Team',
          type: 'multipleRecordLinks',
          options: { linkedTableId: 'tblTeams' },
        },
        { id: 'fldFiles', name: 'Files', type: 'multipleAttachments' },
        { id: 'fldScore', name: 'Score', type: 'formula' },
        { id: 'fldUnsupported', name: 'Nope', type: 'button' },
      ],
    },
    {
      id: 'tblTeams',
      name: 'Teams',
      fields: [{ id: 'fldTeamName', name: 'Name', type: 'singleLineText' }],
    },
  ],
});

describe('pure mapping', () => {
  it('reports snapshot and skipped fields, preserves source IDs and distinguishes schema changes', () => {
    const plan = preflight(fixture, 'appSource01');
    expect(plan.tables).toHaveLength(2);
    expect(plan.issues.map((issue) => issue.kind)).toEqual(['snapshot', 'skip']);
    expect(
      plan.issues.map(({ tableId, tableName, fieldId, fieldName }) => ({
        tableId,
        tableName,
        fieldId,
        fieldName,
      })),
    ).toEqual([
      { tableId: 'tblPeople', tableName: 'People', fieldId: 'fldScore', fieldName: 'Score' },
      { tableId: 'tblPeople', tableName: 'People', fieldId: 'fldUnsupported', fieldName: 'Nope' },
    ]);
    expect(plan.tables[0].sourceRecordIdField.name).toBe('Airtable record ID');
    const collision = preflight(
      parseSchema({
        tables: [
          {
            id: 'tblCollision',
            name: 'Collision',
            fields: [
              { id: 'fldOne', name: 'Airtable record ID', type: 'singleLineText' },
              {
                id: 'fldTwo',
                name: 'Airtable record ID [source fldOne]',
                type: 'singleLineText',
              },
            ],
          },
        ],
      }),
    );
    expect(collision.tables[0].sourceRecordIdField.name).toBe(
      'Airtable record ID [source fldOne 2]',
    );
    expect(plan.tables[0].fields[0].options).toMatchObject({
      sourceBaseId: 'appSource01',
      sourceTableId: 'tblPeople',
      sourceFieldId: 'fldName',
    });
    expect(preflight({ tables: [] }).tables).toEqual([]);
    expect(preflight({ tables: [] }).schemaHash).not.toBe(plan.schemaHash);
  });

  it('maps choice names to IDs and omitted checkbox to false', () => {
    const fields = preflight(fixture).tables[0].fields;
    const role = fields.find((field) => field.sourceId === 'fldRole')!;
    const active = fields.find((field) => field.sourceId === 'fldActive')!;
    expect(mapValue(role, 'Admin')).toEqual({
      value: (role.options.choices as { id: string }[])[0].id,
    });
    expect(mapValue(active, undefined)).toEqual({ value: false });
    expect(() => mapValue(role, 'Nobody')).toThrow('Unknown select choice');
  });

  it('rejects bad values and dangling links before writing', () => {
    const table = preflight(fixture).tables[0];
    expect(() =>
      validateRecordValues(
        [{ id: 'rec1', fields: { fldTeam: ['recMissing'] } }],
        table,
        new Map([['tblTeams', new Set(['recTeam'])]]),
      ),
    ).toThrow('Dangling linked record');
    expect(() => mapValue({ ...table.fields[0], sourceType: 'date' }, '2026-99-99')).toThrow(
      'Invalid date',
    );
    expect(() => mapValue({ ...table.fields[0], sourceType: 'number' }, '2')).toThrow(
      'Invalid number',
    );
  });

  it('accepts explicit skipped IDs but rejects unexpected or name-keyed record fields', () => {
    const table = preflight(fixture).tables[0];
    expect(() =>
      validateRecordValues([{ id: 'rec1', fields: { fldUnsupported: 'anything' } }], table),
    ).not.toThrow();
    expect(() =>
      validateRecordValues([{ id: 'rec1', fields: { fldUnexpected: 'anything' } }], table),
    ).toThrow('Unexpected Airtable field');
    expect(() => validateRecordValues([{ id: 'rec1', fields: { Name: 'Alice' } }], table)).toThrow(
      'Unexpected Airtable field',
    );
  });
});
