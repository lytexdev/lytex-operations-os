import type { AnyEntity } from '@/domain/schemas/entities';
import { FOLDERS } from '@/core/configuration/settings';
import { joinPath, dirname } from './file-store';
import { safeFileName } from '@/shared/utilities/text';
import type { EntityIndex } from '../indexing/entity-index';
import { msg } from '@/shared/i18n';

/**
 * Where new entity files are created. Paths are only a convenience for humans:
 * entities are always identified by their `id`, files may be moved/renamed freely.
 */
export class PathPolicy {
  constructor(
    private readonly root: () => string,
    private readonly index: EntityIndex,
  ) {}

  private r(...p: string[]): string {
    return joinPath(this.root(), ...p);
  }

  folderFor(rel: string): string {
    return this.r(rel);
  }

  /** Folder of a project (directory containing Project.md). */
  projectFolder(projectId: string): string | null {
    const p = this.index.pathOf(projectId);
    return p ? dirname(p) : null;
  }

  pathFor(e: AnyEntity): string {
    switch (e.type) {
      case 'customer':
        return this.r(FOLDERS.customers, `${safeFileName(`${e.customer_number} ${e.name}`)}.md`);
      case 'contact': {
        const c = this.index.get('customer', e.customer_id);
        return this.r(
          FOLDERS.contacts,
          `${safeFileName(`${e.first_name} ${e.last_name}${c ? ` (${c.name})` : ''}`)}.md`,
        );
      }
      case 'interaction': {
        const date = e.occurred_at.slice(0, 10);
        const pf = e.project_id && e.kind === 'meeting' ? this.projectFolder(e.project_id) : null;
        const base = `${safeFileName(`${date} ${e.subject}`)}.md`;
        return pf ? joinPath(pf, 'Meetings', base) : this.r(FOLDERS.interactions, base);
      }
      case 'project':
        return this.r(
          FOLDERS.projects,
          safeFileName(`${e.project_number} ${e.name}`),
          'Project.md',
        );
      case 'ticket': {
        const pf =
          this.projectFolder(e.project_id) ??
          this.r(FOLDERS.projects, msg('_Ohne Projekt', '_No project'));
        return joinPath(pf, 'Tickets', `${safeFileName(`${e.ticket_number} ${e.title}`)}.md`);
      }
      case 'time_entry': {
        const y = e.started_at.slice(0, 4);
        const m = e.started_at.slice(5, 7);
        // Deterministic path from the immutable ID (used for idempotent timer commits).
        return e.source === 'adjustment'
          ? this.r(FOLDERS.timeAdjustments, y, `${e.id}.md`)
          : this.r(FOLDERS.timeEntries, y, m, `${e.id}.md`);
      }
      case 'billing_batch':
        return this.r(FOLDERS.batches, `${safeFileName(e.batch_number)}.md`);
      case 'quote':
        return this.r(FOLDERS.quotes, `${safeFileName(`${e.quote_number} ${e.title}`)}.md`);
      case 'expense':
        return this.r(
          FOLDERS.expenses,
          e.date.slice(0, 4),
          `${safeFileName(`${e.date} ${e.vendor || e.description}`)} ${e.id.slice(-6)}.md`,
        );
      case 'recurring_task':
        return this.r(FOLDERS.recurring, `${safeFileName(e.title)}.md`);
      case 'service':
        return this.r(FOLDERS.services, `${safeFileName(e.name)}.md`);
    }
  }
}
