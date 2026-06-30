'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Colors } from '@/lib/colors';
import { getHexForColor, randomColor } from '@/lib/color-utils';
import type { SelectOption } from '@/lib/field-types';
import { ColorPicker } from './color-picker';

// Simplified port of teable SelectOptions (no drag-reorder / virtualization).
export function SelectOptionsEditor({
  choices,
  onChange,
}: {
  choices: SelectOption[];
  onChange: (c: SelectOption[]) => void;
}) {
  function update(id: string, patch: Partial<SelectOption>) {
    onChange(choices.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function remove(id: string) {
    onChange(choices.filter((c) => c.id !== id));
  }
  function add() {
    const color = randomColor(choices.map((c) => c.color as Colors))[0]!;
    onChange([...choices, { id: crypto.randomUUID(), name: '', color }]);
  }

  return (
    <div className="space-y-2">
      {choices.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger
              className="h-6 w-6 shrink-0 rounded-full border"
              style={{ backgroundColor: getHexForColor(c.color as Colors) ?? '#ccc' }}
              aria-label="Pick color"
            />
            <PopoverContent className="w-auto p-0">
              <ColorPicker value={c.color} onChange={(nc) => update(c.id, { color: nc })} />
            </PopoverContent>
          </Popover>
          <Input
            value={c.name}
            onChange={(e) => update(c.id, { name: e.target.value })}
            placeholder="Option name"
            className="h-8"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => remove(c.id)}
            aria-label="Remove option"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="mr-1 h-4 w-4" /> Add option
      </Button>
    </div>
  );
}
