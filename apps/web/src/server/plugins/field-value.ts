import type { FieldOptions, NormalizedCell } from '@markpocket/plugin-sdk';

import { fieldTypeRegistry } from './registry';

// 服务端值语义分发。注册表由 server/plugins barrel 在首次 import 时填充
// （内建 + 插件贡献）。核心写路径经这些函数施加 ADR-0005 策略（empty/error/value）。
export function parseOptions(type: string, raw: unknown): FieldOptions {
  return fieldTypeRegistry.get(type).optionsSchema.parse(raw ?? {});
}

export function defaultOptions(type: string): FieldOptions {
  return fieldTypeRegistry.get(type).defaultOptions();
}

export function normalizeCellValue(
  type: string,
  options: FieldOptions,
  raw: unknown,
): NormalizedCell {
  return fieldTypeRegistry.get(type).normalizeCellValue(options, raw);
}
