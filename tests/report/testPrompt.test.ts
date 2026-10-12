import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { assembleTestPrompt, buildTestPromptParts } from '../../src/report/testPrompt';

const SHIP = `function shouldShip(order) {
  if ((order.paid || order.invoiced) && order.inStock) {
    ship(order);
  } else {
    hold(order);
  }
  return order.express && !order.oversized;
}`;

const partsFor = (source: string, mode: 'masking' | 'unique-cause' = 'masking') =>
  buildTestPromptParts([{ path: null, analysis: analyzeSource(source, javascriptAdapter, mode) }], mode);

/** Decision blocks of the single snippet file, keyed by decision id (d0, d1, …). */
const blocksFor = (source: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(partsFor(source).files.F0?.decisions ?? {}).map(([key, block]) => [key.replace(/^F0-/, ''), block]),
  );

describe('AI test prompt', () => {
  it('includes instructions, the source and every decision', () => {
    const prompt = assembleTestPrompt(partsFor(SHIP));

    expect(prompt).toContain('achieve MC/DC (modified condition/decision coverage)');
    expect(prompt).toContain('masking MC/DC');
    expect(prompt).toContain('If you cannot tell which one, ask me before writing tests.');
    expect(prompt).toContain('```ts\nfunction shouldShip(order) {');
    expect(prompt).toContain('### Decision 1: if at line 2 in `shouldShip`');
    expect(prompt).toContain('### Decision 2: logical at line 7 in `shouldShip`');
    expect(prompt).toContain('The full report has 7 required tests');
    expect(prompt).not.toContain('9. Put the tests');
  });

  it('lists required rows first with their condition values and expected outcome', () => {
    const block = blocksFor(SHIP).d0 ?? '';

    expect(block).toContain('Required tests: 4 of 5 possible.');
    expect(block).toContain(
      [
        '| Test | C1 | C2 | C3 | Expected outcome | Demonstrates | Status |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| #1 | F | F | – | false | C1, C2 | **required** |',
        '| #2 | F | T | F | false | C3 | **required** |',
        '| #3 | F | T | T | true | C2, C3 | **required** |',
        '| #5 | T | – | T | true | C1 | **required** |',
        '| #4 | T | – | F | false | – | optional |',
      ].join('\n'),
    );
    expect(block).toContain('- C1: tests #1 (F) and #5 (T)');
  });

  it('describes routes by line for each outcome', () => {
    const block = blocksFor(SHIP).d0 ?? '';

    expect(block).toContain(
      'Route when true: start → line 2 `if ((order.paid || order.invoiced) && order.inStock)` → line 3 `ship(order);` → line 7 `return order.express && !order.oversized;` → end',
    );
    expect(block).toContain('Route when false: start → line 2 `if ((order.paid || order.invoiced) && order.inStock)` → line 5 `hold(order);`');
  });

  it('explains that values of negated conditions are taken before the !', () => {
    const block = blocksFor(SHIP).d1 ?? '';

    expect(block).toContain('- C2: `order.oversized` (negated with `!` in the source; T/F is the value before the `!`)');
    expect(block).toContain('- C1: `order.express`\n');
  });

  it('flags conditions that cannot be shown as review notes', () => {
    const block = blocksFor('function f(age, member) { return (age >= 18 && member) || age >= 18; }').d0 ?? '';

    expect(block).toContain('- C2: cannot be shown');
    expect(block).toContain('Note: Cannot be shown: C2 `member`.');
    expect(block).toContain('Note: Coupled conditions');
  });

  it('assembles a prompt for a subset of decisions', () => {
    const parts = partsFor(SHIP);
    const prompt = assembleTestPrompt(parts, ['F0-d1']);

    expect(prompt).toContain('### Decision 2:');
    expect(prompt).not.toContain('### Decision 1:');
    expect(prompt).toContain('## Source code');
  });

  it('uses a longer code fence and inline code when the source contains backticks', () => {
    const parts = partsFor('if (s === `a${"```"}` && ok) go();');

    expect(parts.files.F0?.fence).toBe('````');
    expect(assembleTestPrompt(parts)).toContain('## Source code\n\n````ts\n');
    expect(blocksFor('if (s === `a${"```"}` && ok) go();').d0).toContain('- C1: ```` s === `a${"```"}` ````\n');
  });
});
