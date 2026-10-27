import type { LytexSettings } from '@/core/configuration/settings';
import type { Clock } from '@/shared/date/time';
import type { EntityIndex } from '@/infrastructure/indexing/entity-index';
import type { FileStore } from '@/infrastructure/persistence/file-store';
import type { PathPolicy } from '@/infrastructure/persistence/paths';
import type { Repository } from '@/infrastructure/persistence/repository';

/** Dependencies shared by all use cases (constructed in bootstrap, faked in tests). */
export interface AppContext {
  repo: Repository;
  index: EntityIndex;
  files: FileStore;
  paths: PathPolicy;
  clock: Clock;
  settings(): LytexSettings;
}
