import { z } from 'zod';
import { selectOptionSchema } from './field-types';

/** RPC-only lane key. Existing fields using it must be repaired before board use. */
export const KANBAN_UNAVAILABLE_CHOICE_ID = '__unavailable__';
export const KANBAN_TITLE_TYPES = new Set(['text', 'number', 'date', 'single-select']);

export const kanbanConfigSchema = z.object({
  groupFieldId: z.string().min(1),
  titleFieldId: z.string().min(1).optional(),
});
export type KanbanConfig = z.infer<typeof kanbanConfigSchema>;

type KanbanField = { id: string; type: string; options: unknown };
const choicesSchema = z.object({
  choices: z.array(selectOptionSchema.extend({ id: z.string().min(1) })).max(100),
});

/** Pass only fields belonging to the board's table. Never mutates field options. */
export function validateKanbanFields(config: KanbanConfig, fields: KanbanField[]) {
  const group = fields.find((field) => field.id === config.groupFieldId);
  if (group?.type !== 'single-select')
    throw Error('Kanban status must be a same-table single-select field');
  const parsed = choicesSchema.safeParse(group.options);
  if (!parsed.success) throw Error('Kanban status requires valid choices (at most 100)');
  const choices = parsed.data.choices;
  if (choices.some((choice) => choice.id === KANBAN_UNAVAILABLE_CHOICE_ID)) {
    throw Error(
      'Kanban status choice ID __unavailable__ is reserved; repair this field before using it for a board',
    );
  }
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    throw Error('Kanban status choice IDs must be unique');
  }
  if (
    config.titleFieldId &&
    !KANBAN_TITLE_TYPES.has(fields.find((field) => field.id === config.titleFieldId)?.type ?? '')
  ) {
    throw Error('Kanban title must be a same-table text, number, date or single-select field');
  }
  return choices;
}
