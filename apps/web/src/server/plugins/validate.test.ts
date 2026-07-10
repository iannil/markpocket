import { describe, expect, it, vi } from 'vitest';

// import plugins.config → core-api → @/server/db 会尝试建立 pg 连接；打桩避免真实连接。
vi.mock('@/server/db', () => ({ db: {} }));

import { pluginRouters } from '@/plugins.config';

// 契约：客户端 trpc.csv.* 依赖 csv 出现在合并后的 pluginRouters。
describe('pluginRouters', () => {
  it('exposes the csv namespace', () => {
    expect(Object.keys(pluginRouters)).toContain('csv');
  });
});
