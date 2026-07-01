'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldType, type SelectOption } from '@/lib/field-types';
import type { FilterCondition, FilterGroup } from '@/lib/view-ast';

interface FieldLike {
  id: string;
  name: string;
  type: FieldType;
  options: Record<string, unknown>;
}

interface OpDef {
  value: string;
  label: string;
  operand: boolean;
}

const OPS: Record<string, OpDef[]> = {
  [FieldType.Text]: [
    { value: 'contains', label: 'contains', operand: true },
    { value: 'equals', label: 'is', operand: true },
    { value: 'startsWith', label: 'starts with', operand: true },
    { value: 'empty', label: 'is empty', operand: false },
    { value: 'notEmpty', label: 'is not empty', operand: false },
  ],
  [FieldType.Number]: [
    { value: 'equals', label: '=', operand: true },
    { value: 'gt', label: '>', operand: true },
    { value: 'lt', label: '<', operand: true },
    { value: 'empty', label: 'is empty', operand: false },
    { value: 'notEmpty', label: 'is not empty', operand: false },
  ],
  [FieldType.Boolean]: [
    { value: 'is', label: 'is', operand: true },
    { value: 'empty', label: 'is empty', operand: false },
    { value: 'notEmpty', label: 'is not empty', operand: false },
  ],
  [FieldType.Date]: [
    { value: 'before', label: 'is before', operand: true },
    { value: 'after', label: 'is after', operand: true },
    { value: 'empty', label: 'is empty', operand: false },
    { value: 'notEmpty', label: 'is not empty', operand: false },
  ],
  [FieldType.SingleSelect]: [
    { value: 'equals', label: 'is', operand: true },
    { value: 'empty', label: 'is empty', operand: false },
    { value: 'notEmpty', label: 'is not empty', operand: false },
  ],
};

export function FilterPanel({
  fields,
  filter,
  onChange,
}: {
  fields: FieldLike[];
  filter: FilterGroup | undefined;
  onChange: (f: FilterGroup | undefined) => void;
}) {
  // flat-AND: every leaf is a FilterCondition (Q7b: AST supports nesting, UI defers it).
  const conditions = (filter?.conditions ?? []) as FilterCondition[];
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  function update(i: number, patch: Partial<FilterCondition>) {
    const next = conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ op: 'and', conditions: next });
  }
  function remove(i: number) {
    const next = conditions.filter((_, idx) => idx !== i);
    onChange(next.length ? { op: 'and', conditions: next } : undefined);
  }
  function add() {
    const f = fields[0];
    if (!f) return;
    onChange({
      op: 'and',
      conditions: [...conditions, { fieldId: f.id, operator: OPS[f.type][0]!.value, operand: '' }],
    });
  }

  function renderOperand(cond: FilterCondition, field: FieldLike | undefined, i: number) {
    if (!field) return null;
    const opDef = OPS[field.type].find((o) => o.value === cond.operator);
    if (!opDef || !opDef.operand) return null;
    if (field.type === FieldType.Boolean) {
      return (
        <Select
          value={String(cond.operand ?? 'true')}
          onValueChange={(v) => update(i, { operand: v ?? 'true' })}
        >
          <SelectTrigger className="h-7 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (field.type === FieldType.SingleSelect) {
      const choices = (field.options.choices as SelectOption[]) ?? [];
      return (
        <Select
          value={String(cond.operand ?? '')}
          onValueChange={(v) => update(i, { operand: v ?? '' })}
        >
          <SelectTrigger className="h-7 w-32">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const inputType =
      field.type === FieldType.Number ? 'number' : field.type === FieldType.Date ? 'date' : 'text';
    return (
      <Input
        type={inputType}
        className="h-7 w-40"
        value={String(cond.operand ?? '')}
        onChange={(e) => update(i, { operand: e.target.value })}
      />
    );
  }

  return (
    <div className="space-y-1 rounded border bg-card p-2">
      {conditions.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">No filters — all records shown.</p>
      )}
      {conditions.map((cond, i) => {
        const field = fieldById.get(cond.fieldId);
        const ops = field ? OPS[field.type] : [];
        return (
          <div key={i} className="flex items-center gap-1">
            <Select
              value={cond.fieldId}
              onValueChange={(fid) => {
                if (!fid) return;
                const f = fieldById.get(fid);
                update(i, {
                  fieldId: fid,
                  operator: f ? OPS[f.type][0]!.value : 'equals',
                  operand: '',
                });
              }}
            >
              <SelectTrigger className="h-7 w-32">{field ? field.name : 'Field'}</SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={cond.operator}
              onValueChange={(o) => {
                if (o) update(i, { operator: o });
              }}
            >
              <SelectTrigger className="h-7 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {renderOperand(cond, field, i)}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(i)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add condition
      </Button>
    </div>
  );
}
