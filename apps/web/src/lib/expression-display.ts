// apps/web/src/lib/expression-display.ts
// Expression fields store `{fieldId}` UUID tokens (ADR-0003). Users must
// never see or type UUIDs: this module converts between the stored form and
// a `{Field Name}` display/editing form, used by the grid header and the
// field editor dialog.

export interface ExpressionFieldRef {
  id: string;
  name: string;
}

const TOKEN_RE = /\{([^{}]*)\}/g;

/**
 * Stored → display: `{5cd718dd-…} * 2` becomes `{Age} * 2`. Tokens that do
 * not reference a known field are left untouched (an unknown UUID should
 * stay inspectable rather than be mangled).
 */
export function expressionToDisplay(expr: string, fields: ExpressionFieldRef[]): string {
  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  return expr.replace(TOKEN_RE, (token, id: string) => {
    const name = nameById.get(id);
    return name != null && !/[{}]/.test(name) ? `{${name}}` : token;
  });
}

/**
 * Display → stored: `{Age} * 2` becomes `{5cd718dd-…} * 2`. Names map back
 * by exact match; with duplicate names the first field wins (the stored
 * expression is the source of truth, so a wrong pick surfaces on the next
 * display round-trip). Unmatched tokens pass through unchanged — including
 * raw `{uuid}` tokens, which keeps hand-written stored forms editable.
 */
export function displayToExpression(display: string, fields: ExpressionFieldRef[]): string {
  const idByName = new Map<string, string>();
  for (const f of fields) {
    if (!idByName.has(f.name) && !/[{}]/.test(f.name)) idByName.set(f.name, f.id);
  }
  return display.replace(TOKEN_RE, (token, name: string) => {
    const id = idByName.get(name);
    return id != null ? `{${id}}` : token;
  });
}
