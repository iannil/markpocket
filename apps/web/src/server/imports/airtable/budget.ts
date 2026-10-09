import { AirtableImportError } from './types';

export function canonicalRequestId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new AirtableImportError('invalid_input', 'Invalid import request ID');
  return value.toLowerCase();
}
export class ImportDeadlineError extends AirtableImportError {
  constructor() {
    super('cancelled', 'Import deadline exceeded');
  }
}
// Guard must be called after every awaited acquisition and before each effect.
// Racing a promise alone is insufficient: a late pool callback must not write
// or clean files after the caller has already received a timeout.
export async function withinDeadline<T>(
  deadlineAt: number,
  operation: (guard: () => void) => Promise<T>,
): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = () => {
    if (expired || Date.now() >= deadlineAt) throw new ImportDeadlineError();
  };
  try {
    guard();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          expired = true;
          reject(new ImportDeadlineError());
        },
        Math.max(1, deadlineAt - Date.now()),
      );
    });
    return await Promise.race([
      Promise.resolve().then(() => {
        guard();
        return operation(guard);
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
