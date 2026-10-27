import { msg } from '@/shared/i18n';
/**
 * Integration architecture. Integrations are optional, disabled by default and must only use
 * documented, verified APIs. Credentials are never stored in Markdown/frontmatter.
 *
 * Currently implemented:
 *  - CSV export (local file, no network) – see application/use-cases/billing.ts
 * Prepared but NOT implemented (no network code exists):
 *  - Lexware Office: requires an API key. Obsidian offers no encrypted secret storage to
 *    plugins (data.json is plain text), so the adapter stays disabled until a safe storage
 *    approach is available.
 */
export type IntegrationStatus = 'available' | 'disabled' | 'not_implemented';

export interface IntegrationInfo {
  id: string;
  name: string;
  status: IntegrationStatus;
  description: string;
  requiresSecret: boolean;
}

export interface AccountingExportLine {
  description: string;
  quantityMilli: number;
  unit: string;
  unitPriceCents: number;
  totalCents: number;
}

export interface AccountingExportRequest {
  batchNumber: string;
  customerRef: string;
  currency: string;
  lines: AccountingExportLine[];
}

export interface AccountingExportResult {
  /** External acknowledgement (e.g. invoice draft id). Absent for file exports. */
  externalId: string | null;
  /** True only if the external system verifiably confirmed creation of an invoice. */
  invoiceConfirmed: boolean;
  location: string;
}

/** Adapter contract for accounting systems. */
export interface AccountingAdapter {
  readonly info: IntegrationInfo;
  export(req: AccountingExportRequest): Promise<AccountingExportResult>;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    id: 'csv',
    name: 'CSV-Export',
    status: 'available',
    description: msg(
      'Lokaler Export von Abrechnungsläufen, Zeitnachweisen und Ausgaben.',
      'Local export of billing batches, timesheets and expenses.',
    ),
    requiresSecret: false,
  },
  {
    id: 'lexware-office',
    name: 'Lexware Office',
    status: 'not_implemented',
    description: msg(
      'Vorbereitet (Adapter-Schnittstelle). Keine API-Anbindung, da keine sichere Ablage für API-Schlüssel verfügbar ist.',
      "Prepared (adapter interface). Not connected yet; the API key can be stored in Obsidian's keychain.",
    ),
    requiresSecret: true,
  },
  {
    id: 'github',
    name: 'GitHub Issues',
    status: 'not_implemented',
    description: msg('Geplant. Nicht implementiert.', 'Planned. Not implemented.'),
    requiresSecret: true,
  },
];
