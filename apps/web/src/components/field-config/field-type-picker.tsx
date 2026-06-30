'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FIELD_TYPE_META, FIELD_TYPES, type FieldType } from '@/lib/field-types';

export function FieldTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: FieldType;
  onChange: (t: FieldType) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as FieldType)} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FIELD_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            <span className="font-medium">{FIELD_TYPE_META[t].label}</span>
            <span className="text-muted-foreground"> — {FIELD_TYPE_META[t].description}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
