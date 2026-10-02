import { FieldType, type SelectOption } from '@/lib/field-types';

export interface ClipboardFieldShape {
  id: string;
  type: FieldType;
  options: Record<string, unknown>;
}

export interface ClipboardUserShape {
  id: string;
  name: string | null;
  email: string | null;
}

export type ParsedPaste = { ok: true; value: unknown } | { ok: false; reason: string };

// Paste is single-cell: take the first non-empty line's first TSV segment.
// Multi-cell TSV expansion is intentionally out of scope.
export function firstSegment(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.split('\t')[0]?.trim() ?? '';
}

export function parseClipboardValue(
  field: ClipboardFieldShape,
  users: ClipboardUserShape[],
  text: string,
): ParsedPaste {
  const raw = firstSegment(text);
  if (raw === '') return { ok: false, reason: 'clipboard is empty' };

  switch (field.type) {
    case FieldType.Text:
      return { ok: true, value: raw };

    case FieldType.Number: {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, reason: `"${raw}" is not a number` };
      return { ok: true, value: n };
    }

    case FieldType.Boolean: {
      const v = raw.toLowerCase();
      if (v === 'true') return { ok: true, value: true };
      if (v === 'false') return { ok: true, value: false };
      return { ok: false, reason: `"${raw}" is not true/false` };
    }

    case FieldType.Date: {
      // Only explicit ISO shapes — V8's lenient Date parser accepts garbage
      // like "Octopus 5" (→ Oct 5), which must not silently paste as a date.
      const isoLike =
        /^\d{4}-\d{2}-\d{2}$/.test(raw) ||
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw);
      if (!isoLike) {
        return { ok: false, reason: `"${raw}" is not an ISO date (yyyy-mm-dd)` };
      }
      if (Number.isNaN(new Date(raw).getTime())) {
        return { ok: false, reason: `"${raw}" is not a valid date` };
      }
      return { ok: true, value: raw };
    }

    case FieldType.SingleSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      const match = choices.find((c) => c.id === raw || c.name.toLowerCase() === raw.toLowerCase());
      if (!match) return { ok: false, reason: `"${raw}" is not an option of this field` };
      return { ok: true, value: match.id };
    }

    case FieldType.MultiSelect: {
      const choices = (field.options.choices as SelectOption[] | undefined) ?? [];
      // CSV export joins MultiSelect with '|' (packages/plugin-csv), while
      // hand-typed values tend to use ',' — accept BOTH so values this app
      // exported can be pasted back (they used to be rejected: split was
      // ','-only, so "Todo|Done" matched no option).
      const parts = raw
        .split(/[|,]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const ids: string[] = [];
      for (const part of parts) {
        const match = choices.find(
          (c) => c.id === part || c.name.toLowerCase() === part.toLowerCase(),
        );
        if (!match) return { ok: false, reason: `"${part}" is not an option of this field` };
        if (!ids.includes(match.id)) ids.push(match.id);
      }
      if (ids.length === 0) return { ok: false, reason: 'no matching options' };
      return { ok: true, value: ids };
    }

    case FieldType.User: {
      const match = users.find(
        (u) =>
          u.id === raw ||
          (u.email != null && u.email.toLowerCase() === raw.toLowerCase()) ||
          (u.name != null && u.name.toLowerCase() === raw.toLowerCase()),
      );
      if (!match) return { ok: false, reason: `"${raw}" does not match a user` };
      return { ok: true, value: match.id };
    }

    default:
      // Expression is computed; Link/Attachment hold server-managed ids.
      return { ok: false, reason: `${field.type} cells cannot be pasted` };
  }
}
