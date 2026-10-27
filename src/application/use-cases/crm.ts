import type { AppContext } from '../context';
import type { Contact, Customer, Interaction } from '@/domain/schemas/entities';
import type { CreateInput } from '@/infrastructure/persistence/repository';
import { findDuplicateCustomers, type DuplicateHit } from '@/domain/services/duplicates';
import { nextCustomerNumber } from './numbering';

export type CustomerInput = Omit<CreateInput<'customer'>, 'customer_number'> & {
  customer_number?: string;
};

export function checkCustomerDuplicates(
  ctx: AppContext,
  c: Pick<Customer, 'name' | 'email' | 'website' | 'vat_id' | 'phone'> & { id?: string },
): DuplicateHit[] {
  return findDuplicateCustomers(c, ctx.index.all('customer'));
}

export async function createCustomer(
  ctx: AppContext,
  input: CustomerInput,
  notes = '',
): Promise<Customer> {
  return ctx.repo.create(
    'customer',
    { ...input, customer_number: input.customer_number || nextCustomerNumber(ctx.index) },
    { description: notes },
  );
}

export async function updateCustomer(
  ctx: AppContext,
  id: string,
  patch: Partial<Customer>,
  expectedUpdatedAt?: string,
): Promise<Customer> {
  return ctx.repo.update(
    'customer',
    id,
    (d) => ({ ...d, ...patch, id: d.id, type: d.type, created_at: d.created_at }),
    { expectedUpdatedAt },
  );
}

export async function createContact(
  ctx: AppContext,
  input: CreateInput<'contact'>,
): Promise<Contact> {
  ctx.repo.get('customer', input.customer_id);
  if (input.primary) await clearPrimary(ctx, input.customer_id, null);
  return ctx.repo.create('contact', input);
}

export async function updateContact(
  ctx: AppContext,
  id: string,
  patch: Partial<Contact>,
  expectedUpdatedAt?: string,
): Promise<Contact> {
  const cur = ctx.repo.get('contact', id);
  if (patch.primary) await clearPrimary(ctx, patch.customer_id ?? cur.customer_id, id);
  return ctx.repo.update(
    'contact',
    id,
    (d) => ({ ...d, ...patch, id: d.id, type: d.type, created_at: d.created_at }),
    { expectedUpdatedAt },
  );
}

async function clearPrimary(
  ctx: AppContext,
  customerId: string,
  except: string | null,
): Promise<void> {
  for (const c of ctx.index.all('contact')) {
    if (c.customer_id === customerId && c.primary && c.id !== except) {
      await ctx.repo.update('contact', c.id, (d) => {
        d.primary = false;
      });
    }
  }
}

export async function createInteraction(
  ctx: AppContext,
  input: CreateInput<'interaction'>,
  notes = '',
): Promise<Interaction> {
  ctx.repo.get('customer', input.customer_id);
  if (input.project_id) ctx.repo.get('project', input.project_id);
  return ctx.repo.create('interaction', input, { description: notes });
}
