import type { ProgramModel, SourceRange } from '../model/types';

/** Global the instrumented code reports to (see runtime.ts). */
export const RECORDER = '__mcdc';

interface Insertion {
  readonly position: number;
  readonly text: string;
  readonly opens: boolean;
  /** Size of the wrapped range; outer wrappers open first and close last. */
  readonly size: number;
  /** Decisions wrap their conditions when both cover the same range. */
  readonly rank: number;
}

/**
 * Inserts recording calls around every decision and condition, using the
 * parser's exact source ranges so nothing else in the file changes:
 *
 *   if (a && b)  →  if ((R.b(f,"d0"), R.e(f,"d0", (R.c(f,"d0",0,(a)) && R.c(f,"d0",1,(b))))))
 *
 * `R.c` and `R.e` return the original value, so short-circuiting, the
 * non-boolean results of `&&` / `||`, `this` and `await` behave exactly as
 * before. Each wrapped expression gets its own parentheses, which keeps
 * comma expressions and object literals intact.
 */
export function instrumentSource(program: ProgramModel, fileId: string): string {
  const file = JSON.stringify(fileId);
  const insertions: Insertion[] = [];
  const wrap = (range: SourceRange, before: string, after: string, rank: number): void => {
    const size = range.end - range.start;
    insertions.push({ position: range.start, text: before, opens: true, size, rank });
    insertions.push({ position: range.end, text: after, opens: false, size, rank });
  };

  for (const decision of program.decisions) {
    const id = JSON.stringify(decision.id);
    wrap(decision.range, `(${RECORDER}.b(${file},${id}),${RECORDER}.e(${file},${id},(`, ')))', 0);
    for (const condition of decision.conditions) {
      wrap(condition.range, `${RECORDER}.c(${file},${id},${condition.index},(`, '))', 1);
    }
  }

  insertions.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    // At one position, close the ranges that end here before opening new ones.
    if (a.opens !== b.opens) return a.opens ? 1 : -1;
    // Opening: outer (bigger, then decision) first. Closing: inner first.
    return a.opens ? b.size - a.size || a.rank - b.rank : a.size - b.size || b.rank - a.rank;
  });

  const { source } = program;
  let output = '';
  let cursor = 0;
  for (const insertion of insertions) {
    output += source.slice(cursor, insertion.position) + insertion.text;
    cursor = insertion.position;
  }
  return output + source.slice(cursor);
}
