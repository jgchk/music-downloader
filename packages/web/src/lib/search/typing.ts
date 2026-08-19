/**
 * The request page's typing driver: the one seam that decides *when* a person's typing becomes a
 * search. Today it is a debounce; a future change (say, searching only on Enter) replaces this
 * implementation and nothing else — the page consumes the decision, never the timing.
 *
 * Mirrors the detail page's freshness driver deliberately: same shape, same swap point, so there
 * is one way in this codebase to answer "when does the browser act on its own".
 */

export interface TypingDriver {
  /** Run `onSettled` once the typing pauses; returns a cancel function (idempotent). */
  readonly settle: (onSettled: () => void) => () => void;
}

export function debouncedTyping(delayMs: number): TypingDriver {
  return {
    settle(onSettled: () => void): () => void {
      const handle = setTimeout(onSettled, delayMs);
      return () => {
        clearTimeout(handle);
      };
    },
  };
}

/**
 * Long enough that a phrase is typed before anything is asked of the catalog, short enough that a
 * pause feels answered rather than waited on.
 */
export const SEARCH_DEBOUNCE_MS = 600;

/** Below this, a query says too little to be worth asking about. */
export const MIN_QUERY_LENGTH = 2;

/** The page's driver instance — the swap point. */
export const searchTyping: TypingDriver = debouncedTyping(SEARCH_DEBOUNCE_MS);

/**
 * The typing policy the page delegates to, kept here as a pure unit so the whole decision — too
 * little to search on, search now, or search once the typing settles — is directly testable.
 *
 * Returns the way to abandon a scheduled search, or undefined when there is nothing scheduled.
 */
export function startTyping(
  query: string,
  isImmediate: boolean,
  driver: TypingDriver,
  hooks: { readonly clear: () => void; readonly search: (query: string) => void },
): (() => void) | undefined {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    hooks.clear();
    return undefined;
  }
  if (isImmediate) {
    hooks.search(trimmed);
    return undefined;
  }
  return driver.settle(() => {
    hooks.search(trimmed);
  });
}
