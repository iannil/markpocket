// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { trpc } from '@/lib/trpc/client';
import type { AppRouter } from '@/server/trpc/router';
import { usePagedRecords, type RecordListData } from './use-paged-records';

// A terminating tRPC link that answers record.list from a plain handler, so
// the hook runs against a real react-query + tRPC provider chain without a
// server. `responder` receives the deserialized input and returns either a
// page of data or an error message.
type ListInput = { tableId: string; viewId?: string; offset?: number; limit?: number };
type Responder = (
  input: ListInput,
) => { data: RecordListData; error?: undefined } | { data?: undefined; error: string };

function recordListLink(responder: Responder): TRPCLink<AppRouter> {
  // A link is (runtime) => ({ op }) => Observable — it must return a function
  // directly, not an object with a `request` method.
  return () =>
    ({ op }) =>
      observable((observer) => {
        if (op.path !== 'record.list') {
          observer.error(new TRPCClientError(`unexpected procedure: ${op.path}`));
          return () => {};
        }
        const res = responder(op.input as ListInput);
        if (res.error != null) observer.error(new TRPCClientError(res.error));
        else {
          observer.next({ result: { type: 'data', data: res.data } });
          observer.complete();
        }
        return () => {};
      });
}

function makeWrapper(link: TRPCLink<AppRouter>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const client = trpc.createClient({ links: [link] });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    );
  };
}

const page = (ids: string[], total: number, key: string | null = null): RecordListData => ({
  groups: [{ key, records: ids.map((id) => ({ id, cells: {} })) }],
  total,
});

const flatIds = (groups: ReturnType<typeof usePagedRecords>['groups']) =>
  groups.flatMap((g) => g.records.map((r) => r.id));

describe('usePagedRecords', () => {
  it('page 1 ok + page 2 failing → trailingPageError set, recordsError null (no silent loss)', async () => {
    const wrapper = makeWrapper(
      recordListLink((input) =>
        (input.offset ?? 0) === 0 ? { data: page(['r1'], 250) } : { error: 'boom page 2' },
      ),
    );
    const { result } = renderHook(() => usePagedRecords('t1', undefined), { wrapper });

    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    expect(result.current.recordsError).toBeNull();
    expect(result.current.trailingPageError).toBeNull();

    act(() => result.current.showMore());
    await waitFor(() => expect(result.current.trailingPageError).not.toBeNull());
    // Rows from page 1 stay on screen and the failure is surfaced, not eaten.
    expect(result.current.recordsError).toBeNull();
    expect(result.current.trailingPageError?.message).toBe('boom page 2');
    expect(flatIds(result.current.groups)).toEqual(['r1']);
  });

  it('does not advance past a failed trailing page; retry stays on that page', async () => {
    const offsets: number[] = [];
    const wrapper = makeWrapper(
      recordListLink((input) => {
        offsets.push(input.offset ?? 0);
        return input.offset ? { error: 'page 2 failed' } : { data: page(['r1'], 450) };
      }),
    );
    const { result } = renderHook(() => usePagedRecords('t1', undefined), { wrapper });
    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    act(() => {
      result.current.showMore();
      result.current.showMore();
    });
    await waitFor(() => expect(result.current.trailingPageError).not.toBeNull());
    act(() => result.current.showMore());
    expect(offsets).toEqual([0, 200]);
    act(() => result.current.trailingPageError?.retry());
    await waitFor(() => expect(offsets).toEqual([0, 200, 200]));
  });

  it('page 1 failing → recordsError set, no trailing banner', async () => {
    const wrapper = makeWrapper(recordListLink(() => ({ error: 'boom page 1' })));
    const { result } = renderHook(() => usePagedRecords('t1', undefined), { wrapper });

    await waitFor(() => expect(result.current.recordsError).not.toBeNull());
    expect(result.current.recordsError?.message).toBe('boom page 1');
    expect(result.current.trailingPageError).toBeNull();
  });

  it('all pages ok → no errors, groups merged, total from the freshest page', async () => {
    const wrapper = makeWrapper(
      recordListLink((input) => {
        const offset = input.offset ?? 0;
        return { data: page(offset === 0 ? ['r1', 'r2'] : ['r3'], 3) };
      }),
    );
    const { result } = renderHook(() => usePagedRecords('t1', undefined), { wrapper });

    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    act(() => result.current.showMore());
    await waitFor(() => expect(result.current.anyFetching).toBe(false));

    expect(result.current.recordsError).toBeNull();
    expect(result.current.trailingPageError).toBeNull();
    expect(flatIds(result.current.groups)).toEqual(['r1', 'r2', 'r3']);
    expect(result.current.total).toBe(3);
  });

  it('overlapping offset windows (concurrent delete) dedupe by record id', async () => {
    // Someone else deleted a row between the two "Show more"s: page 2's
    // window slides left and returns r2 again.
    const wrapper = makeWrapper(
      recordListLink((input) => {
        const offset = input.offset ?? 0;
        return { data: page(offset === 0 ? ['r1', 'r2'] : ['r2', 'r3'], 3) };
      }),
    );
    const { result } = renderHook(() => usePagedRecords('t1', undefined), { wrapper });

    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    act(() => result.current.showMore());
    await waitFor(() => expect(result.current.anyFetching).toBe(false));

    const ids = flatIds(result.current.groups);
    expect(ids).toEqual(['r1', 'r2', 'r3']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enabled=false fetches nothing until enabled', async () => {
    let calls = 0;
    const wrapper = makeWrapper(
      recordListLink(() => {
        calls += 1;
        return { data: page(['r1'], 1) };
      }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePagedRecords('t1', undefined, enabled),
      {
        wrapper,
        initialProps: { enabled: false },
      },
    );

    // Give a would-be query time to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
    expect(result.current.recordsLoading).toBe(true);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    expect(calls).toBe(1);
    expect(flatIds(result.current.groups)).toEqual(['r1']);
  });
});

it('stops at the actual end and resets pages on view switch', async () => {
  const calls: string[] = [];
  const wrapper = makeWrapper(
    recordListLink((input) => {
      calls.push(`${input.viewId}:${input.offset}`);
      return { data: page([`${input.viewId}:${input.offset}`], input.viewId === 'v1' ? 2 : 1) };
    }),
  );
  const { result, rerender } = renderHook(({ viewId }) => usePagedRecords('t1', viewId), {
    wrapper,
    initialProps: { viewId: 'v1' },
  });
  await waitFor(() => expect(result.current.recordsLoading).toBe(false));
  act(() => {
    result.current.showMore();
    result.current.showMore();
  });
  await waitFor(() => expect(result.current.hasMore).toBe(false));
  expect(calls).toEqual(['v1:0', 'v1:200']);
  act(() => result.current.showMore());
  expect(calls).toHaveLength(2);
  rerender({ viewId: 'v2' });
  await waitFor(() => expect(flatIds(result.current.groups)).toEqual(['v2:0']));
  expect(calls).toEqual(['v1:0', 'v1:200', 'v2:0']);
});
