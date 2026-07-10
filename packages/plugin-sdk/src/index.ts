export { createRegistry, type Registry } from './registry';

// 一个存储后端的能力面（ADR-0006）。核心只依赖此接口。
export interface StorageProvider {
  /** 为新上传生成存储 key，保留扩展名。 */
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// 具名贡献：{ name, impl }。加载器按 name 注册进对应注册表。
export interface Contribution<T> {
  name: string;
  impl: T;
}

// 插件的声明式清单。缺省字段即不贡献该类扩展点。
// 本计划只有 storage 是真实类型；其余为后续计划收紧的占位。
export interface PluginDefinition {
  name: string;
  version: string;
  storage?: Contribution<StorageProvider>[];
  fieldTypes?: Contribution<unknown>[];
  viewTypes?: Contribution<unknown>[];
  uiSlots?: Contribution<unknown>[];
  events?: Contribution<unknown>[];
  authProviders?: Contribution<unknown>[];
}

// 身份函数：给插件作者类型检查与自动补全。
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}

// --- Server Router 扩展点：核心服务注入 ---

// 最小 drizzle 面（够 CSV 用；宽松以避免 SDK 依赖 app schema）。
export interface DrizzleLike {
  insert: (table: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<unknown[]>;
      execute?: () => Promise<unknown>;
    } & Promise<unknown>;
  };
  // drizzle 的 select 返回一个高度泛型的链式 builder；此处保持 any 以避免 SDK 依赖 app schema。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select: (fields?: unknown) => any;
}

export interface CoreSchema {
  record: unknown;
  cell: unknown;
  field: unknown;
  table: unknown;
}

export interface CoreQueries {
  listRecordsPivoted: (
    tableId: string,
    opts: { where?: unknown; orderBy?: unknown },
    offset?: number,
    limit?: number,
  ) => Promise<Array<{ id: string; cells: Record<string, unknown> }>>;
}

export interface CoreFieldTypes {
  FieldType: Record<string, string>;
  formatNumberToString: (n: number, opts: { precision?: number }) => string;
  parseStringToNumber: (input: string) => number | null;
}

export interface CoreServerApi {
  db: DrizzleLike;
  schema: CoreSchema;
  queries: CoreQueries;
  fieldTypes: CoreFieldTypes;
}

export type ServerRouterFactory<TRouter> = (core: CoreServerApi) => TRouter;

// --- UI Slot 扩展点（client 组件类型在客户端侧收紧为 React 组件）---
export interface UiSlotContribution {
  slotId: string;
  Component: unknown;
}
