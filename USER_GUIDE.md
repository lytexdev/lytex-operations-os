# User guide

On first start LYTEX OS asks for your name (used for assignments and “My work”) and creates the folder
`LYTEX OS/` (configurable in the plugin settings). The interface follows Obsidian's language
(German or English); you can override it in the plugin settings.

Open it via the **briefcase** ribbon icon (main view), the **stopwatch** icon (timer sidebar) or the
command palette → “LYTEX Operations OS: …”. All commands can get custom hotkeys under
_Settings → Hotkeys_ (e.g. _Pause/resume timer_, _Stop and save timer_, _Start timer for ticket…_).

## Typical workflow

1. **Create a customer** (`+ Customer`). Possible duplicates (name, email domain, VAT ID, phone) are
   shown in the form. Never store passwords – only references to your password manager.
2. **Create a project** (3-step wizard): basics → billing model (time & materials, fixed price,
   retainer, internal) and rates → contractual budget and internal estimate. Projects without a
   customer are internal and never billable.
3. **Create tickets** – optionally from a template (bug, feature, maintenance, support). Kanban via
   drag & drop or keyboard (focus a card: Alt+←/→ status, Alt+↑/↓ order).
4. **Track time**: ▶ on a ticket/project, in the timer sidebar or via command. Pause/resume creates
   segments. Project, ticket, note and “billable” can be changed while running. Stopping saves exactly
   one time entry. Very short sessions (below the minimum) ask for confirmation.
5. **Billing**: choose a customer → review entries → _Approve_ → optionally expenses, fixed price,
   retainer months, discount → preview → _Create billing batch_.
6. **Export CSV** (folder `04 Finance/Exports`) and create the invoice in your accounting system.
   Exporting does **not** change any status.
7. **Confirm invoice** with the external invoice number → entries become “invoiced” and locked.
   Later optionally **record payment**.

## Tickets, team and settings

- **Tickets** with filter tabs: _My work_ (all open tickets assigned to you), all open, due soon,
  overdue, done, all.
- **Assigned to**: several people per ticket; type new names directly in the form (they are added to
  the team list). Team and “This is me” under _Settings_.
- **Estimates** in minutes or hours.
- **Description & notes** in a ticket support Markdown and images (🖼 button, Ctrl+V or drag a file in;
  images are stored in the project's `Attachments` folder).
- **Delete** with confirmation (moved to the trash). Records with tracked time or billing data cannot be
  deleted – archive them instead.
- **Settings** page: accent colour, team, API keys (stored in Obsidian's keychain).

## Timer recovery

If the timer was running when Obsidian crashed or closed, the computer restarted or went to sleep, a
dialog appears on the next start (or on wake-up). Time since the last sign of life is **not** counted
automatically. Options: don't count and stop / keep running, set the end of work, confirm the gap as
working time, or discard the session.

## Correcting time entries

- Unbilled/approved entries: ✎ in time tracking – every change is recorded with a reason.
- Invoiced entries are locked. Correct them with **±** (adjustment): a separate entry with positive or
  negative duration at the same rate, billed in the next batch.
- Overlapping entries trigger a warning (or are blocked, depending on settings).

## Views

Dashboard · Tickets (incl. My work) · Customers · Projects (overview, tickets, time, finance) ·
Time tracking (week view, CSV timesheet) · Billing · Quotes · Expenses · Recurring · Services ·
Analytics · Data health · Settings. Global search at the top (↑/↓/Enter). Every record can be opened as a
normal Markdown note (“Open note”); the file context menu offers “LYTEX OS: Open” and “Start timer”.

## Recurring tasks

Daily, weekly (weekdays), monthly (day; 31 = last day of month) or every n days. Tickets are created
_lead time_ days in advance; missed dates (Obsidian was closed) are caught up on start. Each date
creates at most one ticket.

## Editing notes directly

You may edit frontmatter in Obsidian. Invalid values are reported under **Data health**; the file is
ignored until fixed and is never overwritten automatically. The note body (below the frontmatter) is
not changed by the plugin after creation, except when you edit a ticket's description in the plugin.
