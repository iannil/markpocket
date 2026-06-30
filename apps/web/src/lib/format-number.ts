// Simplified port of teable's number formatting (teable's full version carries
// currency/locale/symbol machinery we don't need in Phase 1). Phase 1 honors
// `precision` (decimal places) only; Q5 stores number as float64.

export interface NumberFormatting {
  precision?: number; // decimal places for display
}

export function formatNumberToString(
  value: number | null | undefined,
  formatting?: NumberFormatting,
): string {
  if (value == null || Number.isNaN(value)) return '';
  const precision = formatting?.precision;
  if (precision == null) return String(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

export function parseStringToNumber(input: string): number | null {
  const cleaned = input.trim().replace(/[^0-9eE+\-.]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}
