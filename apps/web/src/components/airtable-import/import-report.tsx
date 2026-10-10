import { formatAirtableBytes } from '@/lib/airtable-import-limits';
import type { ImportReport } from '@/server/imports/airtable/types';

export function ImportReportView({ report }: { report: ImportReport }): React.JSX.Element {
  return (
    <section aria-label="Import reconciliation" className="space-y-3">
      <p>
        {report.tables.length} tables · {report.records} records · {report.cells} cells ·{' '}
        {report.attachments} copied attachments · {formatAirtableBytes(report.attachmentBytes)}{' '}
        copied
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Imported table reconciliation</caption>
          <thead>
            <tr>
              {['Table', 'Records', 'Source ID', 'Target ID'].map((label) => (
                <th key={label} scope="col" className="p-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.tables.map((table) => (
              <tr key={table.sourceId} className="border-t border-border">
                <th scope="row" className="p-2 font-medium break-words">
                  {table.name}
                </th>
                <td className="p-2">{table.records}</td>
                <td className="p-2 font-mono">{table.sourceId}</td>
                <td className="p-2 font-mono">{table.targetId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(['snapshot', 'skip'] as const).map((kind) => {
        const issues = report.issues.filter((issue) => issue.kind === kind);
        return (
          <section key={kind} className="space-y-1 text-xs">
            <h3 className="font-medium">
              {kind === 'snapshot' ? 'Static snapshots' : 'Skipped fields'}
            </h3>
            {kind === 'snapshot' && (
              <p className="text-muted-foreground">These values will not recalculate.</p>
            )}
            {issues.length ? (
              <ul className="ml-4 list-disc break-words">
                {issues.map((issue) => (
                  <li key={`${issue.tableId}:${issue.fieldId}`}>
                    {issue.tableName} ({issue.tableId}) · {issue.fieldName} ({issue.fieldId}) —{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
