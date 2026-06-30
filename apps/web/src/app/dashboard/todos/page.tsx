'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';

import { trpc } from '@/lib/trpc/client';

export default function TodosPage() {
  const [text, setText] = useState('');
  const utils = trpc.useUtils();
  const { data: todos } = trpc.todo.list.useQuery();
  const create = trpc.todo.create.useMutation({
    onSuccess: () => utils.todo.list.invalidate(),
  });
  const toggle = trpc.todo.toggle.useMutation({
    onSuccess: () => utils.todo.list.invalidate(),
  });
  const remove = trpc.todo.delete.useMutation({
    onSuccess: () => utils.todo.list.invalidate(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    create.mutate({ text: text.trim() });
    setText('');
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Hello-World CRUD</h1>
        <p className="text-sm text-gray-600">
          Phase 0 verification: tRPC + Drizzle + auth end-to-end.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New todo…"
          className="flex-1 rounded border p-2"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-black p-2 text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <ul className="space-y-1">
        {todos?.map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded border p-2">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => toggle.mutate({ id: t.id, done: !t.done })}
            />
            <span className={t.done ? 'text-gray-400 line-through' : ''}>{t.text}</span>
            <button onClick={() => remove.mutate({ id: t.id })} className="ml-auto text-red-600">
              delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
