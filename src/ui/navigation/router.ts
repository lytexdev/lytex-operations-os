import { writable, type Readable } from 'svelte/store';

export type RouteName =
  | 'dashboard'
  | 'customers'
  | 'customer'
  | 'projects'
  | 'project'
  | 'tickets'
  | 'ticket'
  | 'time'
  | 'billing'
  | 'batch'
  | 'quotes'
  | 'quote'
  | 'expenses'
  | 'recurring'
  | 'services'
  | 'analytics'
  | 'health'
  | 'search'
  | 'settings';

export interface Route {
  name: RouteName;
  id?: string;
  params?: Record<string, string>;
}

export const LIST_OF: Partial<Record<RouteName, RouteName>> = {
  customer: 'customers',
  project: 'projects',
  ticket: 'tickets',
  batch: 'billing',
  quote: 'quotes',
};

/** Tiny in-view router with back history. Pure TypeScript so it can be unit-tested. */
export class Router {
  private readonly store = writable<Route>({ name: 'dashboard' });
  private history: Route[] = [];
  private currentRoute: Route = { name: 'dashboard' };
  readonly route: Readable<Route> = { subscribe: this.store.subscribe };

  get current(): Route {
    return this.currentRoute;
  }

  go(route: Route): void {
    if (sameRoute(route, this.currentRoute)) return;
    this.history.push(this.currentRoute);
    if (this.history.length > 50) this.history.shift();
    this.set(route);
  }

  replace(route: Route): void {
    this.set(route);
  }

  /**
   * Remember view state (filters, tabs) in the current route without navigating or re-rendering,
   * so that "back" returns to exactly the view the user left.
   */
  patchParams(params: Record<string, string>): void {
    this.currentRoute = {
      ...this.currentRoute,
      params: { ...(this.currentRoute.params ?? {}), ...params },
    };
  }

  back(): void {
    const prev = this.history.pop();
    if (prev) this.set(prev);
  }

  get canGoBack(): boolean {
    return this.history.length > 0;
  }

  private set(route: Route): void {
    this.currentRoute = route;
    this.store.set(route);
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return (
    a.name === b.name &&
    a.id === b.id &&
    JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {})
  );
}
