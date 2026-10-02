// apps/web/src/lib/initials.ts
// Single source for avatar initials. Splits on whitespace and email-ish
// separators so "jane@example.com" yields "JE" rather than "J".

export function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
