import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { parseViewOptionsStrict } from '@/lib/view-ast';
import { validateFormFields, type FormConfig } from '@/lib/form-config';
import { sha256Hex } from '../agent-access/tokens';
import { db } from '../db';
import { baseMember, field, formPublication, table, view } from '../db/schema';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every publication/config/schema mutation and anonymous submission holds this
// lock through commit. If field-order is needed, acquire it BEFORE this lock.
export async function lockFormLifecycle(tx: DbTx, tableId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('view-options:' || ${tableId}))`);
}

async function isOwner(tx: DbTx, tableId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ role: baseMember.role })
    .from(baseMember)
    .innerJoin(table, eq(table.baseId, baseMember.baseId))
    .where(and(eq(table.id, tableId), eq(baseMember.userId, userId)))
    .for('share', { of: baseMember });
  return row?.role === 'owner';
}

export async function assertFormOwner(tx: DbTx, tableId: string, userId: string): Promise<void> {
  if (!(await isOwner(tx, tableId, userId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner role' });
  }
}

export async function revokeViewPublications(tx: DbTx, viewId: string): Promise<void> {
  await tx
    .update(formPublication)
    .set({ revokedAt: new Date() })
    .where(and(eq(formPublication.viewId, viewId), isNull(formPublication.revokedAt)));
}

/** Raw projection check also works for an invalid/empty legacy options blob. */
export function formReferencesField(options: unknown, fieldId: string): boolean {
  const fields = (options as { form?: { fields?: unknown } } | null)?.form?.fields;
  return Array.isArray(fields) && fields.some((entry) => entry?.fieldId === fieldId);
}

export async function revokeFieldPublications(
  tx: DbTx,
  tableId: string,
  fieldId: string,
): Promise<void> {
  const views = await tx
    .select({ id: view.id, options: view.options })
    .from(view)
    .where(and(eq(view.tableId, tableId), eq(view.type, 'form')));
  for (const row of views) {
    if (formReferencesField(row.options, fieldId)) await revokeViewPublications(tx, row.id);
  }
}

async function validConfig(tx: DbTx, row: typeof view.$inferSelect): Promise<FormConfig | null> {
  if (row.type !== 'form') return null;
  const config = parseViewOptionsStrict(row.options)?.form;
  if (!config) return null;
  const fields = await tx
    .select({ id: field.id, type: field.type })
    .from(field)
    .where(eq(field.tableId, row.tableId));
  try {
    validateFormFields(config, fields);
    return config;
  } catch {
    return null;
  }
}

export async function publishForm(tx: DbTx, viewId: string, userId: string, expiresInDays: number) {
  const [initial] = await tx.select().from(view).where(eq(view.id, viewId));
  if (!initial) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
  await lockFormLifecycle(tx, initial.tableId);
  const [current] = await tx.select().from(view).where(eq(view.id, viewId));
  if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'View not found' });
  await assertFormOwner(tx, current.tableId, userId);
  if (!(await validConfig(tx, current))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Form configuration is unavailable' });
  }
  await revokeViewPublications(tx, viewId);
  const token = 'mpf_' + randomBytes(24).toString('hex');
  const publicationId = randomUUID();
  await tx.insert(formPublication).values({
    id: publicationId,
    viewId,
    createdBy: userId,
    tokenHash: sha256Hex(token),
    prefix: token.slice(0, 12),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000),
  });
  return { publicationId, token };
}

export interface ResolvedPublication {
  publicationId: string;
  viewId: string;
  tableId: string;
  ownerId: string;
  config: FormConfig;
}

/** P3 must pass its write transaction, before checking receipts or writing cells.
 * Locks survive until that transaction commits, so revocation, config changes,
 * and owner demotion cannot slip between capability validation and submission.
 */
export async function resolvePublication(
  token: string,
  executor?: DbTx,
): Promise<ResolvedPublication | null> {
  if (!/^mpf_[a-f0-9]{48}$/.test(token)) return null;
  if (!executor) return db.transaction((tx) => resolvePublication(token, tx));
  const tx = executor;
  const hash = sha256Hex(token);
  const [initial] = await tx
    .select({ tableId: view.tableId })
    .from(formPublication)
    .innerJoin(view, eq(view.id, formPublication.viewId))
    .where(eq(formPublication.tokenHash, hash));
  if (!initial) return null;
  await lockFormLifecycle(tx, initial.tableId);
  const [row] = await tx
    .select({ publication: formPublication, view })
    .from(formPublication)
    .innerJoin(view, eq(view.id, formPublication.viewId))
    .where(eq(formPublication.tokenHash, hash));
  if (!row || row.publication.revokedAt || row.publication.expiresAt.getTime() <= Date.now())
    return null;
  if (!(await isOwner(tx, row.view.tableId, row.publication.createdBy))) return null;
  const config = await validConfig(tx, row.view);
  if (!config || row.publication.expiresAt.getTime() <= Date.now()) return null;
  return {
    publicationId: row.publication.id,
    viewId: row.view.id,
    tableId: row.view.tableId,
    ownerId: row.publication.createdBy,
    config,
  };
}
