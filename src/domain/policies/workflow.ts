import type { Ticket } from '../schemas/entities';
import { msg } from '@/shared/i18n';

export type StatusCategory = 'open' | 'active' | 'blocked' | 'done' | 'cancelled';

export interface WorkflowStatus {
  key: string;
  label: string;
  category: StatusCategory;
}

export const DEFAULT_WORKFLOW: WorkflowStatus[] = [
  { key: 'backlog', label: 'Backlog', category: 'open' },
  { key: 'todo', label: 'To Do', category: 'open' },
  { key: 'in_progress', label: 'In Arbeit', category: 'active' },
  { key: 'review', label: 'Review', category: 'active' },
  { key: 'done', label: 'Erledigt', category: 'done' },
  { key: 'cancelled', label: 'Abgebrochen', category: 'cancelled' },
];

/** Default workflow up to settings version 1 (with "Blockiert"); used to migrate untouched defaults. */
export const LEGACY_DEFAULT_WORKFLOW_KEYS = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
];

export interface DoneRules {
  requireChecklistComplete: 'none' | 'required_items' | 'all_items';
  requireDependenciesResolved: boolean;
  requireEstimate: boolean;
  requireTrackedTime: boolean;
}

export const DEFAULT_DONE_RULES: DoneRules = {
  requireChecklistComplete: 'none',
  requireDependenciesResolved: false,
  requireEstimate: false,
  requireTrackedTime: false,
};

export function statusOf(workflow: WorkflowStatus[], key: string): WorkflowStatus | undefined {
  return workflow.find((s) => s.key === key);
}

export function categoryOf(workflow: WorkflowStatus[], key: string): StatusCategory {
  // Unknown statuses (e.g. after the user removed one from the workflow) are treated as open.
  return statusOf(workflow, key)?.category ?? 'open';
}

export function isClosed(workflow: WorkflowStatus[], key: string): boolean {
  const c = categoryOf(workflow, key);
  return c === 'done' || c === 'cancelled';
}

export function validateWorkflow(workflow: WorkflowStatus[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const s of workflow) {
    if (!/^[a-z][a-z0-9_]*$/.test(s.key))
      errors.push(msg(`Ungültiger Status-Schlüssel: ${s.key}`, `Invalid status key: ${s.key}`));
    if (keys.has(s.key))
      errors.push(msg(`Doppelter Status: ${s.key}`, `Duplicate status: ${s.key}`));
    keys.add(s.key);
    if (!s.label.trim())
      errors.push(msg(`Status ${s.key} hat keine Bezeichnung`, `Status ${s.key} has no label`));
  }
  if (!workflow.some((s) => s.category === 'done'))
    errors.push(
      msg('Mindestens ein Status muss „erledigt“ sein', 'At least one status must be “done”'),
    );
  if (!workflow.some((s) => s.category === 'open'))
    errors.push(
      msg('Mindestens ein Status muss „offen“ sein', 'At least one status must be “open”'),
    );
  return errors;
}

export interface DoneCheckContext {
  workflow: WorkflowStatus[];
  rules: DoneRules;
  dependencies: Pick<Ticket, 'id' | 'ticket_number' | 'status'>[];
  trackedSeconds: number;
}

/** Returns the list of violated Definition-of-Done rules; empty means the ticket may be closed as done. */
export function checkDefinitionOfDone(ticket: Ticket, ctx: DoneCheckContext): string[] {
  const problems: string[] = [];
  const { rules } = ctx;
  if (rules.requireChecklistComplete === 'all_items' && ticket.checklist.some((c) => !c.done)) {
    problems.push(
      msg('Nicht alle Checklistenpunkte sind erledigt', 'Not all checklist items are done'),
    );
  }
  if (
    rules.requireChecklistComplete === 'required_items' &&
    ticket.checklist.some((c) => c.required && !c.done)
  ) {
    problems.push(msg('Pflicht-Checklistenpunkte sind offen', 'Required checklist items are open'));
  }
  if (rules.requireDependenciesResolved) {
    const open = ctx.dependencies.filter((d) => !isClosed(ctx.workflow, d.status));
    if (open.length)
      problems.push(
        msg(
          `Offene Abhängigkeiten: ${open.map((d) => d.ticket_number || d.id).join(', ')}`,
          `Open dependencies: ${open.map((d) => d.ticket_number || d.id).join(', ')}`,
        ),
      );
  }
  if (rules.requireEstimate && !ticket.estimated_seconds)
    problems.push(msg('Keine Aufwandsschätzung hinterlegt', 'No effort estimate'));
  if (rules.requireTrackedTime && ctx.trackedSeconds <= 0)
    problems.push(msg('Keine erfasste Zeit', 'No tracked time'));
  return problems;
}

/** Detect cycles when adding dependency edges. `deps` maps ticket id → ids it depends on. */
export function wouldCreateCycle(deps: Map<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of deps.get(cur) ?? []) stack.push(n);
  }
  return false;
}
