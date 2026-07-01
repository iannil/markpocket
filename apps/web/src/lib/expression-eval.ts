// Expression evaluation for write-time materialization (ADR-0003, Q2).
// Arithmetic only (+, -, *, /, parentheses) on number cell values.
// Token substitution: {fieldId} → value. Validates post-substitution to prevent
// injection before Function() eval. NOT a DSL parser — uses JS's native arithmetic.

export type EvalResult = { value: number } | { error: string } | { empty: true };

export function evaluateExpression(expr: string, values: Map<string, unknown>): EvalResult {
  if (!expr.trim()) return { empty: true };

  // Substitute {fieldId} tokens with cell values.
  let substituted = expr;
  const tokenPattern = /\{([a-f0-9-]+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(expr)) !== null) {
    const fieldId = match[1]!;
    const raw = values.get(fieldId);
    if (raw == null || raw === '') {
      // Dependency missing → expression result is empty (Q4: empty = no row).
      return { empty: true };
    }
    const num = Number(raw);
    if (Number.isNaN(num)) {
      return { error: `Non-numeric dependency` };
    }
    substituted = substituted.replace(match[0], String(num));
  }

  // Validate: only digits, operators, parentheses, whitespace.
  if (!/^[0-9+\-*/().\s]*$/.test(substituted)) {
    return { error: 'Invalid expression' };
  }

  const trimmed = substituted.trim();
  if (!trimmed) return { empty: true };

  try {
    const result = Function('"use strict"; return (' + trimmed + ')')() as unknown;
    if (typeof result !== 'number') return { error: 'Not a number' };
    if (Number.isNaN(result)) return { error: 'Not a number' };
    if (!Number.isFinite(result)) return { error: 'Division by zero' };
    return { value: result };
  } catch {
    return { error: 'Evaluation failed' };
  }
}

// Extract fieldId dependencies from an expression string (token scan, Q3).
export function extractDependsOn(expr: string): string[] {
  const ids: string[] = [];
  const pattern = /\{([a-f0-9-]+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(expr)) !== null) {
    ids.push(match[1]!);
  }
  return [...new Set(ids)];
}
