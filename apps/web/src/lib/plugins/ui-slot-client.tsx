'use client';

import type { ComponentType } from 'react';

type SlotComponent = ComponentType<{ ctx?: unknown }>;

const slots = new Map<string, SlotComponent[]>();

export function registerSlot(slotId: string, Component: SlotComponent): void {
  const list = slots.get(slotId) ?? [];
  list.push(Component);
  slots.set(slotId, list);
}

export function Slot({ id, ctx }: { id: string; ctx?: unknown }) {
  const list = slots.get(id) ?? [];
  return (
    <>
      {list.map((C, i) => (
        <C key={i} ctx={ctx} />
      ))}
    </>
  );
}
