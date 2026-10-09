// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      client: {
        airtableImport: { preflight: { mutate: mocks.preflight }, start: { mutate: mocks.start } },
      },
    }),
    airtableImport: {
      status: { useQuery: (...args: unknown[]) => mocks.query(...args) },
      cancel: { useMutation: () => ({ mutateAsync: mocks.cancel, isPending: false }) },
    },
  },
}));
vi.mock('@/lib/breadcrumb-context', () => ({ useBreadcrumbSetter: () => {} }));
import Page from './page';

const report = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  sourceBaseId: 'app12345678',
  baseId: 'base-new',
  tables: [],
  records: 2,
  cells: 4,
  attachments: 0,
  attachmentBytes: 0,
  issues: [],
};
const preview = {
  schemaHash: 'a'.repeat(64),
  tables: [
    {
      sourceId: 'tbl12345678',
      name: 'People',
      fields: [],
      sourceFieldIds: [],
      skippedFieldIds: [],
      sourceRecordIdField: {
        sourceId: 'id',
        name: 'Airtable record ID',
        type: 'text',
        options: {},
        sourceType: 'text',
      },
    },
  ],
  issues: [
    {
      tableId: 'tbl12345678',
      tableName: 'People',
      fieldId: 'fld1',
      fieldName: 'Unsupported',
      kind: 'skip',
      message: 'Unsupported field',
    },
  ],
};
function fill() {
  fireEvent.change(screen.getByLabelText('Airtable Base ID'), { target: { value: 'app12345678' } });
  fireEvent.change(screen.getByLabelText('Read-only personal access token'), {
    target: { value: 'pat-secret' },
  });
  fireEvent.change(screen.getByLabelText('New Base name'), { target: { value: 'Imported' } });
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.query.mockReturnValue({ data: undefined, isError: false });
  mocks.preflight.mockResolvedValue(preview);
  mocks.start.mockResolvedValue(report);
  mocks.cancel.mockResolvedValue({ cancelled: true });
});
afterEach(cleanup);

it('requires preflight and acknowledgement, then sends its current hash and request ID', async () => {
  render(<Page />);
  fill();
  expect(screen.queryByRole('button', { name: 'Create new Base' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  expect(
    (screen.getByRole('button', { name: 'Create new Base' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await waitFor(() =>
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaHash: preview.schemaHash,
        requestId: expect.any(String),
        acceptLosses: true,
      }),
    ),
  );
  expect(sessionStorage.getItem('airtable-import-request-id')).toBeNull();
  expect((screen.getByLabelText('Read-only personal access token') as HTMLInputElement).value).toBe(
    '',
  );
  expect(screen.getByRole('link', { name: 'Open new Base' }).getAttribute('href')).toBe(
    '/bases/base-new',
  );
});

it('starts a second import with a new request ID after completion', async () => {
  mocks.query.mockReturnValue({
    data: { status: 'running', progress: { phase: 'writing', records: 1, attachments: 0 } },
    isError: false,
  });
  const secondReport = {
    ...report,
    requestId: '550e8400-e29b-41d4-a716-446655440001',
    baseId: 'base-second',
  };
  mocks.start.mockResolvedValueOnce(report).mockResolvedValueOnce(secondReport);
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  expect((await screen.findByRole('link', { name: 'Open new Base' })).getAttribute('href')).toBe(
    '/bases/base-new',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start another import' }));
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
  expect(mocks.start.mock.calls[1][0].requestId).not.toBe(mocks.start.mock.calls[0][0].requestId);
  expect((await screen.findByRole('link', { name: 'Open new Base' })).getAttribute('href')).toBe(
    '/bases/base-second',
  );
});

it('does not let an older start response overwrite a new import after polling confirms completion', async () => {
  let resolveStart!: (value: typeof report) => void;
  let completedReport: typeof report | null = null;
  mocks.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
  );
  mocks.query.mockImplementation((input: { requestId: string }) => ({
    data:
      completedReport && input.requestId === completedReport.requestId
        ? { status: 'complete', report: completedReport }
        : undefined,
    isError: false,
  }));
  const view = render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
  completedReport = { ...report, requestId: mocks.start.mock.calls[0][0].requestId };
  view.rerender(<Page />);
  expect(await screen.findByRole('link', { name: 'Open new Base' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Start another import' }));
  fill();
  await act(async () => resolveStart(completedReport!));
  expect(screen.queryByRole('link', { name: 'Open new Base' })).toBeNull();
  expect((screen.getByLabelText('Read-only personal access token') as HTMLInputElement).value).toBe(
    'pat-secret',
  );
});

it('identifies each skipped field and table in preview and result', async () => {
  const issues = [
    {
      tableId: 'tblPeople',
      tableName: 'People',
      fieldId: 'fldButton',
      fieldName: 'Action',
      kind: 'skip',
      message: 'Unsupported Airtable field type',
    },
    {
      tableId: 'tblTeams',
      tableName: 'Teams',
      fieldId: 'fldButton2',
      fieldName: 'Workflow',
      kind: 'skip',
      message: 'Unsupported Airtable field type',
    },
  ];
  mocks.preflight.mockResolvedValue({ ...preview, issues });
  mocks.start.mockResolvedValue({ ...report, issues });
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  expect(await screen.findByText(/People.*Action.*fldButton/)).toBeTruthy();
  expect(screen.getByText(/Teams.*Workflow.*fldButton2/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await screen.findByRole('link', { name: 'Open new Base' });
  expect(screen.getByText(/People.*Action.*fldButton/)).toBeTruthy();
  expect(screen.getByText(/Teams.*Workflow.*fldButton2/)).toBeTruthy();
});

it('allows cancellation while running and never reports success from cancel alone', async () => {
  let release!: (value: typeof report) => void;
  mocks.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: 'Open new Base' })).toBeNull();
  release(report);
});

it('clears the token on error and retries with the same request ID', async () => {
  mocks.start.mockRejectedValueOnce(new Error('Import failed'));
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await screen.findByText('Import failed');
  const first = mocks.start.mock.calls[0][0].requestId;
  expect((screen.getByLabelText('Read-only personal access token') as HTMLInputElement).value).toBe(
    '',
  );
  fireEvent.change(screen.getByLabelText('Read-only personal access token'), {
    target: { value: 'new-pat' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
  expect(mocks.start.mock.calls[1][0].requestId).toBe(first);
});

it('restores only the request ID on refresh', () => {
  sessionStorage.setItem('airtable-import-request-id', report.requestId);
  render(<Page />);
  expect(mocks.query).toHaveBeenCalledWith(
    { requestId: report.requestId },
    expect.objectContaining({ enabled: true }),
  );
  expect((screen.getByLabelText('Read-only personal access token') as HTMLInputElement).value).toBe(
    '',
  );
});

it('shows a completed receipt after refresh without asking for the token', async () => {
  sessionStorage.setItem('airtable-import-request-id', report.requestId);
  mocks.query.mockImplementation((input: { requestId: string }) => ({
    data: input.requestId === report.requestId ? { status: 'complete', report } : undefined,
    isError: false,
  }));
  render(<Page />);
  expect(await screen.findByRole('link', { name: 'Open new Base' })).toBeTruthy();
  expect((screen.getByLabelText('Read-only personal access token') as HTMLInputElement).value).toBe(
    '',
  );
  expect(sessionStorage.getItem('airtable-import-request-id')).toBeNull();
});

it('restores active progress and cancellation from a running server status', async () => {
  sessionStorage.setItem('airtable-import-request-id', report.requestId);
  mocks.query.mockImplementation((input: { requestId: string }) => ({
    data:
      input.requestId === report.requestId
        ? { status: 'running', progress: { phase: 'records', records: 42, attachments: 3 } }
        : undefined,
    isError: false,
    refetch: mocks.status,
  }));
  mocks.status.mockResolvedValue({ data: { status: 'not-running' } });
  render(<Page />);
  expect(await screen.findByText(/records · 42 records · 3 attachments/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ requestId: report.requestId }));
  expect(screen.queryByRole('link', { name: 'Open new Base' })).toBeNull();
});

it('discards a preflight response after its source Base changes', async () => {
  let release!: (value: typeof preview) => void;
  mocks.preflight.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  fireEvent.change(screen.getByLabelText('Airtable Base ID'), { target: { value: 'app87654321' } });
  release(preview);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview import' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Create new Base' })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it('returns to retry guidance when a restored request is no longer running', async () => {
  sessionStorage.setItem('airtable-import-request-id', report.requestId);
  let serverStatus = 'running';
  mocks.query.mockImplementation((input: { requestId: string }) => ({
    data:
      input.requestId === report.requestId
        ? serverStatus === 'running'
          ? { status: 'running', progress: { phase: 'writing', records: 9, attachments: 0 } }
          : { status: 'not-running' }
        : undefined,
    isError: false,
  }));
  const view = render(<Page />);
  expect(await screen.findByRole('button', { name: 'Cancel import' })).toBeTruthy();
  serverStatus = 'not-running';
  view.rerender(<Page />);
  expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  expect(screen.getByText(/No running import found/)).toBeTruthy();
});

it('hides running controls once the start response confirms completion', async () => {
  mocks.query.mockImplementation((input: { requestId: string }) => ({
    data: input.requestId
      ? { status: 'running', progress: { phase: 'writing', records: 2, attachments: 0 } }
      : undefined,
    isError: false,
  }));
  render(<Page />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText(/Unsupported field/);
  fireEvent.click(screen.getByLabelText(/I understand/));
  fireEvent.click(screen.getByRole('button', { name: 'Create new Base' }));
  expect(await screen.findByRole('link', { name: 'Open new Base' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
});
