# Airtable import (preview)

The Workspace **Import from Airtable** wizard creates a new markpocket Base from one Airtable Base. It does not update an existing Base or keep the two systems synchronized. This is an early migration path, not a claim of full Airtable compatibility.

## Before starting

1. Back up the markpocket database and local uploads together. Pause edits in the source Airtable Base until the import finishes: paginated Airtable reads do not form a consistent snapshot.
2. Create an Airtable personal access token with only `schema.bases:read` and `data.records:read`, and grant it access to only the source Base. The wizard needs no write scope. Keep the token private; it is held in page memory for the current attempt and is not saved in markpocket's database, URL, or browser storage. Configure reverse proxies and request tracing so they do not log request bodies containing the token.
3. Use the local storage adapter. The importer does not support other storage adapters yet. Check available disk space for attachment copies as well as the database size.

Open Workspace → **Import from Airtable**, enter the Base ID (`app…`), token, and new Base name, and select **Preview import**. Review every mapped field and the static or skipped fields. If issues appear, acknowledge them before **Create new Base** is enabled. Wait for the result, then open the new Base and download the JSON report. Keep the report for the source-to-target table ID mapping and issue list; it contains no PAT or attachment URLs.

## Field treatment

| Airtable source type | markpocket result |
| --- | --- |
| Single-line/multiline/rich text, email, URL, phone | Text |
| Number, currency, percent, duration, rating | Number |
| Checkbox | Boolean; omitted source values become `false` |
| Date, date-time | Date; time inclusion follows the source type |
| Single/multiple select | Choices matched by name to target choice IDs |
| Multiple attachments | Copied into local storage, with target attachment metadata |
| Multiple record links | Linked target record IDs, resolved after records are created |
| Formula, rollup, lookup, count, auto number, created/modified time | Static text snapshot, named `[snapshot]`; no expression or live calculation |
| Other field types | Skipped and listed in preview and report |

Each target table gains an **Airtable record ID** text field, with a suffix if that name already exists. Source Base, table and field IDs are retained in field metadata. Airtable automations, Interfaces, views, permissions, comments, and history are not migrated.

## Limits and retry behavior

An attempt may contain at most 20 tables, 100 source fields per table, 10,000 records total, 100,000 nonempty cells including source IDs, 16 MiB of JSON record data, 200 unique attachments, 10 MiB per attachment, and 64 MiB of attachment bytes overall. The entire attempt has a 120-second deadline. Exceeding a limit fails explicitly and does not create a partial Base.

The wizard keeps only a request ID in session storage so a refresh can recover a running or completed status. It does not keep the token. On failure or cancellation, enter the token again, preview again, and retry with the same request ID. A completed request ID returns the existing result rather than creating a duplicate Base. Cancelling is cooperative; if commit already completed, the result is the completed Base. If that Base was later deleted, retrying its request ID creates a new import, not a sync or restoration of the deleted Base.

## Administrator recovery of local files

A crash can leave an import journal and attachment files. The cleanup command checks the receipt under an advisory lock and removes only files recorded by incomplete journals. It preserves files belonging to committed imports. Run it with the same database and storage settings as the app, from the repository root; the web package command runs with `apps/web` as its working directory:

```bash
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB' \
UPLOAD_DIR='/absolute/path/to/uploads' \
AIRTABLE_IMPORT_JOURNAL_DIR='/absolute/path/to/uploads/.airtable-import-journals' \
pnpm --filter @markpocket/web exec tsx scripts/cleanup-airtable-imports.ts
```

`AIRTABLE_IMPORT_JOURNAL_DIR` may be omitted when the app used its default `$UPLOAD_DIR/.airtable-import-journals`. Use the exact paths from the app; do not point the command at arbitrary upload directories. The command reports a recovered journal count. If it reports an error, retain the journal/files for inspection and retry once database access is restored. The command is local administration, not a public API.

The [acceptance evidence](release/2026-10-10-airtable-import-evidence.md) distinguishes fixture verification from live Airtable verification. A real Airtable PAT was unavailable for that acceptance run, so real Airtable end-to-end migration remains unverified.
