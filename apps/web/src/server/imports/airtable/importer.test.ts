import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createImporter } from './importer';

type Database = (typeof import('../../db'))['db'];
describe('database deadline guards', () => {
  it('bounds database acquisition and does not open a late transaction', async () => {
    let release!: (db: Database) => void;
    const acquisition = new Promise<Database>((resolve) => {
      release = resolve;
    });
    const transaction = vi.fn();
    const importer = createImporter({ database: () => acquisition });
    await expect(importer.receipt('user', randomUUID(), Date.now() + 10)).rejects.toThrow(
      'deadline',
    );
    release({ transaction } as unknown as Database);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transaction).not.toHaveBeenCalled();
  });
  it('bounds pool acquisition and guards a late transaction callback', async () => {
    let release!: () => Promise<void>;
    const execute = vi.fn();
    const transaction = vi.fn(
      (callback: (tx: unknown) => Promise<unknown>) =>
        new Promise((resolve, reject) => {
          release = async () => {
            try {
              resolve(await callback({ execute }));
            } catch (error) {
              reject(error);
            }
          };
        }),
    );
    const importer = createImporter({
      database: async () => ({ transaction }) as unknown as Database,
    });
    await expect(importer.receipt('user', randomUUID(), Date.now() + 10)).rejects.toThrow(
      'deadline',
    );
    await release();
    expect(execute).not.toHaveBeenCalled();
  });
});
