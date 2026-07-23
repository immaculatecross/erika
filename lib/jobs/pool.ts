// A bounded-concurrency worker pool (E-27). `runPool` processes `items` through at
// most `concurrency` in-flight `handle` calls, so the per-segment cascade overlaps
// its model calls without ever exceeding a cap on how many are in flight at once.
//
// Fail-fast, not fail-whole: the FIRST rejection stops new items from starting, but
// items already in flight are allowed to settle (a model call cannot be un-sent, and
// its reservation must be released or finalized), and the first error is rethrown
// once the pool drains. An item whose failure should NOT stop the batch — a single
// unreadable segment (E-16 criterion 4) — must swallow that failure inside `handle`;
// only the errors that should halt the whole run (budget, network, auth) escape it.

/**
 * Run `handle` over `items` with at most `concurrency` (floored to ≥1) in flight.
 * Resolves when every item that started has settled; rejects with the first error
 * `handle` threw, after the in-flight items drain. Order of processing is not
 * guaranteed — callers that care about output order must sort on read.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  handle: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = Math.max(1, Math.floor(concurrency));
  let next = 0;
  let firstError: unknown = null;

  async function worker(): Promise<void> {
    for (;;) {
      if (firstError !== null) return; // a sibling failed — stop taking new items
      const i = next++;
      if (i >= items.length) return;
      try {
        await handle(items[i], i);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(n, items.length) }, () => worker());
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
}
