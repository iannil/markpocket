import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { field, formSubmission, writeReceipt } from '../db/schema';
import { mapBusyToConflict } from '../db/pg-errors';
import { normalizeCellValue, parseOptions } from '../plugins/field-value';
import { publishTableChange } from '../realtime/publish';
import { writeBatchInTransaction } from '../records/write-batch';
import { resolvePublication, type DbTx, type ResolvedPublication } from './publications';

export const MAX_FORM_BODY_BYTES = 65536;
const submissionSchema = z
  .object({
    requestId: z.string().uuid().toLowerCase(),
    cells: z.record(z.string(), z.unknown()).refine((cells) => Object.keys(cells).length <= 50),
  })
  .strict();
type SubmissionInput = z.infer<typeof submissionSchema>;

function unavailable(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Form is unavailable' });
}

// Read under the resolver's lifecycle lock, and retain the field row locks
// through the write. Never acquire field-order after the lifecycle lock.
async function selectedFields(tx: DbTx, publication: ResolvedPublication) {
  const fields = await tx
    .select()
    .from(field)
    .where(
      and(
        eq(field.tableId, publication.tableId),
        inArray(
          field.id,
          publication.config.fields.map((f) => f.fieldId),
        ),
      ),
    )
    .orderBy(field.id)
    .for('share');
  const byId = new Map(fields.map((f) => [f.id, f]));
  return publication.config.fields.map((config) => {
    const f = byId.get(config.fieldId);
    if (!f) return unavailable();
    // Parse with the registered schema before projecting individual safe keys.
    // Raw options can contain private import/source metadata.
    let options: Record<string, unknown>;
    try {
      options = parseOptions(f.type, f.options);
    } catch {
      return unavailable();
    }
    return { ...f, options, required: config.required };
  });
}

function safeOptions(type: string, options: Record<string, unknown>): Record<string, unknown> {
  if (type === 'single-select' || type === 'multi-select') {
    const choices = options.choices as { id: string; name: string; color: string }[];
    return { choices: choices.map(({ id, name, color }) => ({ id, name, color })) };
  }
  if (type === 'date') return { includeTime: options.includeTime };
  if (type === 'number') return { precision: options.precision };
  return {};
}

export async function getPublicForm(token: string) {
  return mapBusyToConflict(
    db.transaction(async (tx) => {
      const publication = await resolvePublication(token, tx);
      if (!publication) return unavailable();
      const fields = await selectedFields(tx, publication);
      const { title, description, successMessage } = publication.config;
      return {
        title,
        description,
        successMessage,
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          options: safeOptions(f.type, f.options),
          required: f.required,
        })),
      };
    }),
  );
}

export async function submitForm(token: string, raw: SubmissionInput): Promise<{ ok: true }> {
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid form submission' });
  // Zod intentionally drops __proto__ from records. Check the original keys
  // so an extra field cannot disappear before the allowlist validation.
  const submittedKeys = Object.keys(raw.cells);
  if (submittedKeys.length > 50)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Too many form fields' });
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cells must be JSON serializable' });
  }
  if (bytes > MAX_FORM_BODY_BYTES)
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' });
  const input = parsed.data;
  const tableId = await mapBusyToConflict(
    db.transaction(async (tx) => {
      // Capability validation precedes ALL receipt checks, even on replays.
      const publication = await resolvePublication(token, tx);
      if (!publication) return unavailable();
      const fields = await selectedFields(tx, publication);
      const allowed = new Set(fields.map((f) => f.id));
      if (submittedKeys.some((id) => !allowed.has(id)))
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Submission contains an unavailable field',
        });
      for (const f of fields) {
        const value = normalizeCellValue(f.type, f.options, input.cells[f.id]);
        if ('error' in value)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid field value' });
        if (f.required && ('empty' in value || (f.type === 'boolean' && value.value !== true)))
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Required field is empty' });
      }
      const actorKey = `form:${publication.publicationId}`;
      const [audit] = await tx
        .select()
        .from(formSubmission)
        .where(
          and(
            eq(formSubmission.publicationId, publication.publicationId),
            eq(formSubmission.requestId, input.requestId),
          ),
        );
      // Audits outlive F's seven-day receipts. Reuse after receipt expiry must
      // require a fresh UUID, never create a record hidden by an ignored audit.
      const [receipt] = await tx
        .select({ id: writeReceipt.requestId })
        .from(writeReceipt)
        .where(
          and(
            eq(writeReceipt.actorKey, actorKey),
            eq(writeReceipt.requestId, input.requestId),
            sql`${writeReceipt.createdAt} >= now() - interval '7 days'`,
          ),
        );
      if (audit && !receipt)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Submission receipt expired; use a new request ID',
        });
      const result = await writeBatchInTransaction(
        tx,
        { key: actorKey, userId: null },
        {
          tableId: publication.tableId,
          requestId: input.requestId,
          rows: [{ cells: input.cells }],
        },
      );
      // An active receipt proves the original atomic audit succeeded. A record
      // deletion may have cascaded that audit away; replay acknowledges earlier
      // acceptance without recreating either the deleted record or its audit.
      if (!receipt)
        await tx.insert(formSubmission).values({
          id: randomUUID(),
          publicationId: publication.publicationId,
          requestId: input.requestId,
          recordId: result.recordIds[0]!,
        });
      return publication.tableId;
    }),
  );
  // Anonymous changes have no echo-suppressed user; notification failures do
  // not turn a committed submission into a failure or log sensitive inputs.
  void publishTableChange(tableId).catch(() => console.error('Form change notification failed'));
  return { ok: true };
}
