// Per-request account context for the HTTP transport.
//
// Tools and the store call `currentAccount()` with no plumbing changes:
// the route handler wraps each authenticated request in `runWithAccount`,
// and AsyncLocalStorage carries the account through the async call chain.
// Outside HTTP (stdio/local dev/tests) there is no context and callers
// fall back to base-repo behavior.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  account: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithAccount<T>(account: string, fn: () => T): T {
  return storage.run({ account }, fn);
}

/** Account name for the current HTTP request, or null outside HTTP context. */
export function currentAccount(): string | null {
  return storage.getStore()?.account ?? null;
}
