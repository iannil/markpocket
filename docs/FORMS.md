# Public submission forms

Form views accept anonymous responses into one table. They show only the fields
explicitly selected in the Form builder. The link grants submission capability;
it does not grant access to existing records, attachments, or members.

## Build and preview

Use **+ view**, choose **Form**, enter a name, and create the view. Owners and
editors can set the title, description, success message, public fields, field
order, and required settings, then **Save form**. Viewers see a disabled preview.
Form views never run the Grid records query.

Choose 1–50 distinct fields. Supported types are text, number, boolean, date,
single-select, and multi-select. Attachments, users, linked records, expressions,
and conditional logic are unavailable. New table fields are not selected
automatically. Title, description, and success message limits are 120, 2,000,
and 500 characters. Required boolean fields are explicitly labeled **must be
checked**; numeric zero is valid. Select controls submit choice IDs.

## Publish, rotate, and revoke

Only owners can publish, rotate, or revoke submission links. Save configuration
before publishing. The default link lifetime is 30 days; owners can choose
1–365 days. Copy the complete URL when it is shown after publication. Tokens are
stored as hashes on the server; the UI keeps the complete URL only in current
component memory, never localStorage. After refresh, rotate to get a new link.
Rotation revokes earlier publications. Revoke closes the selected publication.

Changing selected fields, their order, or required flags revokes publications;
selected field deletion or semantic option changes also revoke them. Text-only
Form edits retain links. Invalid or unsupported configurations cannot publish or
accept responses. A publisher who loses owner membership loses the submission
capability. Form views cannot create read-only shares; legacy Form share tokens
fail closed for public metadata, record reads, attachments, and RSS. Share tokens
cannot be used as submission tokens.

## Anonymous submission and retries

The public page uses semantic native controls and supports narrow screens.
Pending submissions disable duplicate attempts. Success displays only the configured
message, never a database record ID. Public GET exposes safe field options only;
POST accepts `{requestId,cells}`. The server validates required values, rejects
extra fields and invalid types, and writes cells, expression results, and history
atomically. Anonymous `createdBy`/`changedBy` values are null. Internal submission
audits do not impersonate a user.

If the response is uncertain, **Retry** sends the exact frozen body and request ID.
A valid receipt replays the historical acceptance even if the accepted record was
later deleted. Editing an input after an attempt requires **Confirm new submission**
and creates a new request ID. The page warns that the earlier response may already
exist. A known submission UUID whose seven-day receipt expired returns a conflict;
it also requires explicit confirmation before another submission. Do not assume a
failure means no record was created. Reloading discards the in-memory retry state.

Public pages and API responses use no-store/no-referrer, and pages request
noindex/nofollow. There are no third-party form resources. POST checks same origin
and limits the streamed body to 64 KiB. Single-process rate limits are 30 submissions
per publication per minute and 120 total per minute; GET has its own budget. These
limits are abuse thresholds, not a spam-prevention guarantee.

## Delivery evidence

This feature is implemented locally and covered by component/API/isolated PostgreSQL
fixtures. Current acceptance results and remaining live browser checks are recorded
in [P0–P2 evidence](release/2026-10-10-p0-p2-evidence.md). It is unpublished; fixture
results do not establish live Airtable acceptance or a deployed release.
