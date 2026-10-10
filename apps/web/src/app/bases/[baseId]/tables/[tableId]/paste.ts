const MAX_ROWS = 100;
const MAX_CELLS = 500;
const MAX_BYTES = 1024 * 1024;

/** Parse clipboard TSV without discarding intentional empty cells or quoted line breaks. */
export function parseTsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error('Paste is too large');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let cells = 0;
  const cell = () => {
    row.push(value);
    value = '';
    closed = false;
    if (++cells > MAX_CELLS) throw Error('Paste exceeds the batch limit');
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS) throw Error('Paste exceeds the batch limit');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
      continue;
    }
    if (c === '\t') {
      cell();
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
      continue;
    }
    if (closed) throw Error('Unexpected text after closing quote');
    if (c === '"') {
      if (value.length) throw Error('Unexpected quote');
      quoted = true;
    } else value += c;
  }
  if (quoted) throw Error('Unclosed quoted cell');
  // A terminal row delimiter creates no extra row; preceding empty rows remain.
  if (!/[\r\n]$/.test(text) || row.length || value.length || closed) line();
  return rows;
}

export function planPaste(
  matrix: string[][],
  recordIds: string[],
  fieldIds: string[],
  anchor: { row: number; column: number },
  allowAppend: boolean,
): { recordId?: string; values: { fieldId: string; text: string }[] }[] {
  const width = matrix[0]?.length ?? 0;
  if (
    !matrix.length ||
    matrix.length > MAX_ROWS ||
    !width ||
    matrix.some((row) => row.length !== width) ||
    matrix.length * width > MAX_CELLS
  )
    throw Error('Paste must be a rectangle of at most 100 rows and 500 cells');
  if (
    !Number.isInteger(anchor.row) ||
    !Number.isInteger(anchor.column) ||
    anchor.row < 0 ||
    anchor.column < 0 ||
    anchor.column + width > fieldIds.length
  )
    throw Error('Paste exceeds visible columns');
  if (
    anchor.row > recordIds.length ||
    (anchor.row + matrix.length > recordIds.length && !allowAppend)
  ) {
    throw Error('Load rows or use an unfiltered view to append');
  }
  return matrix.map((row, i) => ({
    recordId: recordIds[anchor.row + i],
    values: row.map((text, j) => ({ fieldId: fieldIds[anchor.column + j]!, text })),
  }));
}
