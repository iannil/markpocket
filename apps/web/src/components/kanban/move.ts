import { KANBAN_UNAVAILABLE_CHOICE_ID } from '@/lib/kanban-config';

/** Moves change only status; reserved and unknown lanes are never write targets. */
export async function moveCard(
  input: {
    recordId: string;
    fieldId: string;
    choiceId: string | null;
    allowed: string[];
    readOnly: boolean;
  },
  write: (value: { recordId: string; fieldId: string; value: string | null }) => Promise<unknown>,
): Promise<void> {
  if (input.readOnly) throw Error('This board is read-only');
  if (
    input.choiceId !== null &&
    (input.choiceId === KANBAN_UNAVAILABLE_CHOICE_ID || !input.allowed.includes(input.choiceId))
  )
    throw Error('Status is unavailable');
  await write({ recordId: input.recordId, fieldId: input.fieldId, value: input.choiceId });
}
