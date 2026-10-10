# Kanban views

Status: implemented locally on 2026-10-10; isolated PostgreSQL and component
fixtures verified. Controller browser checks cover board creation, configuration,
paging, failed move/retry, keyboard menus, 390px layout, viewer permissions and
native drag/drop. Record detail browser checks also verify current-draft retry,
native Tab, Escape focus, read-only viewer/expression and expression refresh.
Same-origin multiplayer runtime acceptance remains pending. This work is unpublished.

Create a **Kanban** view from the table view tabs. Editors configure a status field
from the same table with type **Single select** (up to 100 choices). The optional
title field supports text, number, date or single select. Empty choices keep their
lanes; records without a status appear in **No status**. Old or malformed values
appear in **Unavailable**, which is never a move destination. Deleted fields or
changed status field types show a configuration repair prompt.

Each lane loads 50 cards independently. **Load more** fetches the next page only
for that lane. Counts cover all records matching the view filter, including cards
not loaded yet. Existing view filters and sorting apply on the server, with record
IDs breaking ties. Moving changes the status value; it does not create manual
card ordering. A filter can remove the moved record from the view.

Editors can drag cards or use **Move to…** on keyboard or touch. Arrow keys,
Home/End and Escape operate the menu. A pending card shows **Saving…** and blocks
another move until it settles. Failed moves keep the original lane and show an
error. Successful moves refresh lanes, full counts and Grid data, and retain the
existing last-write-wins notification when a recent edit was overwritten.

**Open details** opens the record drawer for editors and viewers. Fields follow
the table field order. Editors use the same typed field editors as Grid; text,
number and date use **Save** or Enter. Changing focus does not save those drafts.
A failed save keeps the entered value. Text, number and date keep their **Save**
button, which submits the current draft after any corrections; other field types
offer **Retry save**. Tab moves focus normally in detail inputs without saving.
Escape cancels an inline field edit; Escape from the drawer closes it and restores the card button
focus. Expressions are always read-only. Viewer and unresolved member permissions
keep all fields read-only. The server separately checks current membership and
the record's exact owning table for every read/write.

Public read-only shares of Kanban views render the existing Grid projection.
Hidden fields are removed from metadata and cells, and view filters still
constrain rows. Public shares do not expose the member record detail API or any
write operation. Form views remain ineligible for read-only sharing.
