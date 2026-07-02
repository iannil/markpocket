'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FieldLike {
  id: string;
  name: string;
}

export function ViewFieldsMenu({
  fields,
  hiddenFields,
  onChange,
}: {
  fields: FieldLike[];
  hiddenFields: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string, visible: boolean) {
    onChange(visible ? hiddenFields.filter((x) => x !== id) : [...hiddenFields, id]);
  }

  return (
    <Popover>
      <PopoverTrigger className="flex h-7 items-center rounded-md border border-border px-2 text-sm hover:bg-muted">
        Fields
      </PopoverTrigger>
      <PopoverContent className="w-56 border-border">
        <div className="space-y-0.5">
          {fields.map((f) => (
            <label
              key={f.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={!hiddenFields.includes(f.id)}
                onChange={(e) => toggle(f.id, e.target.checked)}
              />
              {f.name}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
