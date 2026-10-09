import type { Readable } from 'node:stream';

export { createRegistry, type Registry } from './registry';

// Plugins throw this (same class the host's tRPC runtime understands) so host
// routers and plugin routers produce identical structured tRPC errors.
export { TRPCError } from '@trpc/server';

// 一个存储后端的能力面（ADR-0006）。核心只依赖此接口。
export interface StorageProvider {
  /** 为新上传生成存储 key，保留扩展名。 */
  makeKey(filename: string): string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /**
   * 可选流式读取：下载路径用它把文件分块送出，避免把整个文件（上限
   * 50MB）读进内存 —— get() 的整块 Buffer 路径只应留给需要随机访问的
   * 消费方。键校验语义与 get() 一致（拒绝即 reject）。返回 Node Readable
   * 而不是 web 流：宿主（Node 服务器）用 Readable.toWeb 自行转换，并能在
   * 源流上挂终态钩子（'close' 覆盖 正常结束/出错/客户端取消 三种路径，
   * 下载并发槽位的归还依赖它）。可选方法：未实现的提供方走 get() 整块
   * 回退路径。
   */
  getStream?(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

// 具名贡献：{ name, impl }。加载器按 name 注册进对应注册表。
export interface Contribution<T> {
  name: string;
  impl: T;
}

// 插件的声明式清单。缺省字段即不贡献该类扩展点。
// 只有真实存在消费者的扩展点才出现在这里（"no premature abstraction"，
// ADR-0006 的增量缝原则应用到插件系统自身）。viewType / uiSlot / event /
// authProvider 曾是占位骨架，已删除 —— 需要时连注册表一起加回。
export interface PluginDefinition {
  name: string;
  version: string;
  storage?: Contribution<StorageProvider>[];
  fieldTypes?: Contribution<FieldTypeContribution>[];
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
  /** History log for first-value audit rows on plugin-written cells (ADR-0005). */
  cellHistory: unknown;
}

export interface CoreQueries {
  listRecordsPivoted: (
    tableId: string,
    opts: { where?: unknown; orderBy?: unknown },
    offset?: number,
    limit?: number,
  ) => Promise<Array<{ id: string; cells: Record<string, unknown> }>>;
  /**
   * Materialize expression cells for one record (ADR-0003). Must run inside the
   * caller's transaction — `tx` is the tx handle the host's drizzle db hands to
   * `db.transaction` callbacks, passed through opaquely. Resolves with the
   * materialized outcomes so callers can surface refreshed values to their
   * clients.
   */
  materializeExpressionsForRecord: (
    tx: unknown,
    tableId: string,
    recordId: string,
    userId: string,
    changedFieldId?: string,
  ) => Promise<Array<{ fieldId: string; value: unknown }>>;
}

export interface CoreFieldTypes {
  FieldType: Record<string, string>;
  formatNumberToString: (n: number, opts: { precision?: number }) => string;
  parseStringToNumber: (input: string) => number | null;
  /** Host-wired registry dispatch — plugins reuse core value semantics instead
   *  of forking them (options come from the field row). */
  normalizeCellValue: (type: string, options: FieldOptions, raw: unknown) => NormalizedCell;
}

/** Role gate injected from the host so plugin routers enforce base authorization. */
export interface CoreAuth {
  /** Throws (FORBIDDEN/NOT_FOUND) unless `userId` holds at least `minRole` on the table's base. */
  assertTableRole(
    tableId: string,
    userId: string,
    minRole: 'viewer' | 'editor' | 'owner',
  ): Promise<void>;
}

/**
 * Realtime broadcast face injected from the host (ADR-0002): any plugin
 * mutation that commits writes must notify the base's other online clients —
 * without it, a plugin import leaves every other client stale until its next
 * local edit. Post-commit only: these notices describe committed state and
 * must never be called inside a transaction.
 */
export interface CoreRealtime {
  /**
   * Broadcast a table-scoped change notice to the base's other subscribers.
   * `exceptUserId` is echo suppression — pass the mutating user's id (their
   * own client refetches via the tRPC response instead).
   */
  publishTableChange(tableId: string, exceptUserId?: string): Promise<void>;
}

export interface CoreServerApi {
  db: DrizzleLike;
  schema: CoreSchema;
  queries: CoreQueries;
  fieldTypes: CoreFieldTypes;
  auth: CoreAuth;
  realtime: CoreRealtime;
  exports: {
    tableCsv(
      tableId: string,
      userId: string,
    ): Promise<{
      csv: string;
      exported: number;
      truncated: false;
    }>;
  };
}

export type ServerRouterFactory<TRouter> = (core: CoreServerApi) => TRouter;

// --- UI Slot 扩展点（client 组件类型在客户端侧收紧为 React 组件）---
export interface UiSlotContribution {
  slotId: string;
  Component: unknown;
}

// --- Field Type 扩展点（server 侧值语义）---

export type CellValue = string | number | boolean | string[];
export type FieldOptions = Record<string, unknown>;
export type NormalizedCell = { empty: true } | { value: CellValue } | { error: string };

// 结构化 options 校验面：任何 zod object schema 的 .parse 结构上满足它，SDK 因此不依赖 zod。
export interface OptionsSchema {
  parse(raw: unknown): FieldOptions;
}

// Second-phase validation context: the host resolves id existence with one
// batched query (inArray) so per-value checks stay O(1) round-trips.
export interface ValueValidationContext {
  /** Resolves to the subset of `ids` that exist as records of `tableId`. */
  existingRecordIds(ids: string[], tableId: string): Promise<Set<string>>;
  /**
   * Resolves to the subset of `ids` that exist as attachments of the base the
   * field being written belongs to. Base scoping is the host's job — the field
   * contribution has no way (and no business) resolving its own base, so the
   * resolver binds it to the field's table → base at the call site. An id from
   * another base therefore resolves as "missing", which is exactly the verdict
   * attachment validation wants (L-2: 跨 base 的附件 id = 脏引用).
   */
  existingAttachmentIds(ids: string[]): Promise<Set<string>>;
}

export interface FieldTypeContribution {
  type: string;
  optionsSchema: OptionsSchema;
  defaultOptions: () => FieldOptions;
  normalizeCellValue: (options: FieldOptions, raw: unknown) => NormalizedCell;
  /**
   * Optional DB-backed second phase after normalizeCellValue returned a value
   * (e.g. link: every referenced id must be an existing record of the target
   * table). Returns an error message, or null when the value is acceptable.
   */
  validateCellValue?: (
    options: FieldOptions,
    value: CellValue,
    ctx: ValueValidationContext,
  ) => Promise<string | null>;
  meta: { label: string; description: string };
}
