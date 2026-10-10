// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ImportReport } from '@/server/imports/airtable/types';
import { ImportReportView } from './import-report';

afterEach(cleanup);
const report: ImportReport = {
  requestId: 'request',
  sourceBaseId: 'appSource',
  baseId: 'target',
  records: 2,
  cells: 4,
  attachments: 1,
  attachmentBytes: 1536,
  tables: [{ sourceId: 'src', targetId: 'dst', name: 'People', records: 2 }],
  issues: [
    {
      tableId: 'src',
      tableName: 'People',
      fieldId: 'f',
      fieldName: 'Total',
      kind: 'snapshot',
      message: 'Static result',
    },
    {
      tableId: 'src',
      tableName: 'People',
      fieldId: 'g',
      fieldName: 'Action',
      kind: 'skip',
      message: 'Unsupported field',
    },
  ],
};
it('reconciles totals, copied bytes, table IDs and both issue categories', () => {
  render(<ImportReportView report={report} />);
  expect(screen.getByText(/2 records · 4 cells · 1 copied attachments · 1.5 KiB/)).toBeTruthy();
  const table = screen.getByRole('table');
  for (const value of ['People', 'src', 'dst', '2'])
    expect(within(table).getByText(value)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Static snapshots' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Skipped fields' })).toBeTruthy();
  expect(screen.getByText(/People.*Total.*Static result/)).toBeTruthy();
  expect(screen.getByText(/People.*Action.*Unsupported field/)).toBeTruthy();
  expect(screen.getByText('These values will not recalculate.')).toBeTruthy();
});
it('renders untrusted names as text and never exposes extra credentials or source URLs', () => {
  const name = '<img src=x onerror=alert(1)>';
  const input = {
    ...report,
    token: 'secret-pat',
    attachmentUrl: 'https://source.invalid/file',
    tables: [{ ...report.tables[0], name }],
    issues: [
      {
        ...report.issues[0],
        tableName: '<script>source</script>',
        fieldName: '<svg onload=alert(1)>',
        message: '<b>snapshot</b>',
      },
    ],
  };
  const { container } = render(<ImportReportView report={input} />);
  expect(screen.getByText(name)).toBeTruthy();
  expect(container.querySelector('img, script, svg, b')).toBeNull();
  expect(container.textContent).toContain('<script>source</script>');
  expect(container.textContent).toContain('<svg onload=alert(1)>');
  expect(container.textContent).toContain('<b>snapshot</b>');
  expect(container.textContent).not.toContain('secret-pat');
  expect(container.textContent).not.toContain('https://source.invalid/file');
  expect(container.querySelector('a')).toBeNull();
});
it('shows empty categories and zero bytes honestly', () => {
  render(<ImportReportView report={{ ...report, attachmentBytes: 0, issues: [] }} />);
  expect(screen.getByText(/0 B copied/)).toBeTruthy();
  expect(screen.getAllByText('None')).toHaveLength(2);
});
