import type { Customer } from '../schemas/entities';
import { levenshtein, normalize, stripLegalForm } from '@/shared/utilities/text';
import { msg } from '@/shared/i18n';

export interface DuplicateHit {
  customer: Customer;
  reasons: string[];
}

function domainOf(s: string): string {
  const v = s.trim().toLowerCase();
  if (!v) return '';
  const at = v.lastIndexOf('@');
  const host = at >= 0 ? v.slice(at + 1) : (v.replace(/^https?:\/\//, '').split('/')[0] ?? '');
  return host.replace(/^www\./, '');
}

const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'outlook.com',
  'hotmail.com',
  't-online.de',
  'yahoo.com',
  'yahoo.de',
  'icloud.com',
  'posteo.de',
  'mailbox.org',
  'freenet.de',
]);

/** Warn about likely duplicate customers (name similarity, same email/website domain, VAT ID, phone). */
export function findDuplicateCustomers(
  candidate: Pick<Customer, 'name' | 'email' | 'website' | 'vat_id' | 'phone'> & { id?: string },
  existing: Customer[],
): DuplicateHit[] {
  const name = stripLegalForm(candidate.name);
  const emailDomain = domainOf(candidate.email);
  const webDomain = domainOf(candidate.website);
  const vat = normalize(candidate.vat_id).replace(/\s/g, '');
  const phone = candidate.phone.replace(/\D/g, '').slice(-8);
  const hits: DuplicateHit[] = [];
  for (const c of existing) {
    if (c.id === candidate.id) continue;
    const reasons: string[] = [];
    const other = stripLegalForm(c.name);
    if (name && other) {
      if (name === other) reasons.push(msg('Gleicher Name', 'Same name'));
      else if (name.length > 4 && levenshtein(name, other, 3) <= 2)
        reasons.push(msg('Sehr ähnlicher Name', 'Very similar name'));
    }
    if (
      candidate.email &&
      c.email &&
      candidate.email.trim().toLowerCase() === c.email.trim().toLowerCase()
    )
      reasons.push(msg('Gleiche E-Mail', 'Same email'));
    else if (
      emailDomain &&
      !FREEMAIL.has(emailDomain) &&
      (emailDomain === domainOf(c.email) || emailDomain === domainOf(c.website))
    )
      reasons.push(msg('Gleiche Domain', 'Same domain'));
    if (
      webDomain &&
      webDomain === domainOf(c.website) &&
      !reasons.includes(msg('Gleiche Domain', 'Same domain'))
    )
      reasons.push(msg('Gleiche Website', 'Same website'));
    if (vat && vat === normalize(c.vat_id).replace(/\s/g, ''))
      reasons.push(msg('Gleiche USt-IdNr.', 'Same VAT ID'));
    if (phone.length >= 6 && phone === c.phone.replace(/\D/g, '').slice(-8))
      reasons.push(msg('Gleiche Telefonnummer', 'Same phone number'));
    if (reasons.length) hits.push({ customer: c, reasons });
  }
  return hits;
}
