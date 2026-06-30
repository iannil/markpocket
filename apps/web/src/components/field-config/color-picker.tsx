'use client';

import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Colors } from '@/lib/colors';
import { COLOR_PALETTE, getHexForColor } from '@/lib/color-utils';

// UX adapted from teable SelectOptions/ColorPicker; data from ported COLOR_PALETTE.
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: Colors) => void }) {
  return (
    <div className="flex w-64 flex-wrap gap-1 p-1">
      {COLOR_PALETTE.flat().map((c) => {
        const hex = getHexForColor(c) ?? '#ccc';
        const selected = c === value;
        return (
          <Button
            key={c}
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full border p-0"
            style={{ backgroundColor: hex }}
            onClick={() => onChange(c)}
            aria-label={c}
          >
            {selected && <Check className="h-3 w-3 text-white" />}
          </Button>
        );
      })}
    </div>
  );
}
