import { expect, it, vi } from 'vitest';
import { moveCard } from './move';

it('refuses viewer moves and invalid targets without writing, and permits clearing status', async () => {
  const write = vi.fn();
  const input = {
    recordId: 'r',
    fieldId: 'f',
    choiceId: 'todo',
    allowed: ['todo'],
    readOnly: false,
  };
  await expect(moveCard({ ...input, readOnly: true }, write)).rejects.toThrow('read-only');
  await expect(moveCard({ ...input, choiceId: 'unknown' }, write)).rejects.toThrow('unavailable');
  await expect(
    moveCard({ ...input, choiceId: '__unavailable__', allowed: ['__unavailable__'] }, write),
  ).rejects.toThrow('unavailable');
  expect(write).not.toHaveBeenCalled();
  await moveCard({ ...input, choiceId: null }, write);
  expect(write).toHaveBeenCalledWith({ recordId: 'r', fieldId: 'f', value: null });
});
it('writes only the status and propagates failure', async () => {
  const write = vi.fn().mockRejectedValue(new Error('Save failed'));
  await expect(
    moveCard(
      { recordId: 'r', fieldId: 'f', choiceId: 'todo', allowed: ['todo'], readOnly: false },
      write,
    ),
  ).rejects.toThrow('Save failed');
  expect(write).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith({ recordId: 'r', fieldId: 'f', value: 'todo' });
});
