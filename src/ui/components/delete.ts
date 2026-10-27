import type { UiApi } from '../stores/ui-api';
import { t } from '@/shared/i18n';
import { deleteEntity, deletionImpact, type DeletableType } from '@/application/use-cases/delete';

/**
 * Ask "Möchtest du … wirklich löschen?" (listing everything deleted along), then delete.
 * Returns true when deleted. Blocked deletions are explained instead of asking.
 */
export async function confirmDelete(
  api: UiApi,
  type: DeletableType,
  id: string,
  label: string,
): Promise<boolean> {
  const impact = deletionImpact(api.ctx, type, id);
  if (impact.blockers.length) {
    api.notify(`${t('delete.blocked', { label })} ${impact.blockers.join(' ')}`, 'error');
    return false;
  }
  const lines = [t('delete.question', { label })];
  if (impact.cascade.length)
    lines.push(t('delete.cascade', { list: impact.cascade.map((c) => c.label).join(', ') }));
  if (impact.unlink.length) lines.push(t('delete.unlink', { n: impact.unlink.length }));
  lines.push(t('delete.trashHint'));
  if (!(await api.confirm(t('common.delete'), lines.join('\n'), t('common.delete')))) return false;
  const ok = await api.run(
    async () => (await deleteEntity(api.ctx, type, id), true),
    t('delete.done', { label }),
  );
  return ok === true;
}
