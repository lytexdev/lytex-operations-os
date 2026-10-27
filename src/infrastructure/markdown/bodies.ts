import type { AnyEntity } from '@/domain/schemas/entities';
import { msg } from '@/shared/i18n';
import type { EntityIndex } from '../indexing/entity-index';
import { basename } from '../persistence/file-store';

/** Wiki link to another entity's note (by current file name), or a plain ID if not indexed. */
export function linkTo(index: EntityIndex, id: string | null | undefined): string {
  if (!id) return '–';
  const path = index.pathOf(id);
  if (!path) return id;
  const name = basename(path).replace(/\.md$/, '');
  const target = path.replace(/\.md$/, '');
  return name === 'Project' ? `[[${target}|${projectLabel(index, id)}]]` : `[[${target}|${name}]]`;
}

function projectLabel(index: EntityIndex, id: string): string {
  const p = index.get('project', id);
  return p ? `${p.project_number} ${p.name}` : id;
}

/**
 * Initial Markdown body for new entity notes. The body belongs to the user afterwards; the plugin
 * only rewrites frontmatter. The note stays understandable without the plugin.
 */
export function initialBody(e: AnyEntity, index: EntityIndex, description = ''): string {
  const desc = description.trim() ? `${description.trim()}\n\n` : '';
  const customer = msg('Kunde', 'Customer');
  const project = msg('Projekt', 'Project');
  const notes = msg('Notizen', 'Notes');
  switch (e.type) {
    case 'customer':
      return `# ${e.name}\n\n${desc}## ${notes}\n\n## ${msg('Zugangsdaten', 'Access')}\n\n${msg('Keine Passwörter hier speichern – nur Verweise auf den Passwort-Manager.', 'Do not store passwords here – only references to your password manager.')}\n`;
    case 'contact':
      return `# ${e.first_name} ${e.last_name}\n\n${customer}: ${linkTo(index, e.customer_id)}\n\n${desc}## ${notes}\n`;
    case 'interaction':
      return `# ${e.subject}\n\n${customer}: ${linkTo(index, e.customer_id)}${e.project_id ? `\n${project}: ${linkTo(index, e.project_id)}` : ''}\n\n${desc}## ${msg('Protokoll', 'Minutes')}\n\n## ${msg('Nächste Schritte', 'Next steps')}\n`;
    case 'project':
      return `# ${e.project_number} ${e.name}\n\n${customer}: ${e.customer_id ? linkTo(index, e.customer_id) : msg('Intern', 'Internal')}\n\n${desc}## ${msg('Ziele', 'Goals')}\n\n## ${msg('Dokumentation', 'Documentation')}\n\n## ${notes}\n`;
    case 'ticket':
      return `# ${e.ticket_number} ${e.title}\n\n${project}: ${linkTo(index, e.project_id)}\n\n## ${msg('Beschreibung', 'Description')}\n\n${desc}## ${notes}\n`;
    case 'time_entry':
      return `# ${msg('Zeiteintrag', 'Time entry')} ${e.started_at.slice(0, 10)}\n\n${project}: ${linkTo(index, e.project_id)}${e.ticket_id ? `\nTicket: ${linkTo(index, e.ticket_id)}` : ''}\n\n${e.description || desc}\n`;
    case 'billing_batch':
      return `# ${msg('Abrechnungslauf', 'Billing batch')} ${e.batch_number}\n\n${customer}: ${linkTo(index, e.customer_id)}\n\n${msg('Vorbereitung für die Rechnungsstellung im Buchhaltungssystem. Dies ist **keine** Rechnung.', 'Preparation for invoicing in your accounting system. This is **not** an invoice.')}\n`;
    case 'quote':
      return `# ${msg('Angebot', 'Quote')} ${e.quote_number}: ${e.title}\n\n${customer}: ${linkTo(index, e.customer_id)}\n\n${msg('Entwurf zur Information – ersetzt kein rechtskonformes Angebot aus dem Buchhaltungssystem.', 'Informational draft – does not replace a legally compliant quote from your accounting system.')}\n\n${desc}`;
    case 'expense':
      return `# ${msg('Ausgabe', 'Expense')} ${e.date}: ${e.description}\n\n${e.receipt ? `${msg('Beleg', 'Receipt')}: ${e.receipt}\n\n` : ''}${desc}`;
    case 'recurring_task':
      return `# ${e.title}\n\n${project}: ${linkTo(index, e.project_id)}\n\n${msg('Wiederkehrende Aufgabe – Tickets werden automatisch erzeugt.', 'Recurring task – tickets are generated automatically.')}\n\n${desc}`;
    case 'service':
      return `# ${e.name}\n\n${desc}`;
  }
}
