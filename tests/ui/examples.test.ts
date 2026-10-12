import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { EXAMPLES } from '../../src/ui/examples';

describe('built-in examples', () => {
  it.each(EXAMPLES.map((example) => [example.id, example.source]))('%s parses cleanly and has decisions', (_, source) => {
    const { program } = analyzeSource(source, javascriptAdapter, 'masking');

    expect(program.diagnostics).toEqual([]);
    expect(program.decisions.length).toBeGreaterThan(0);
  });

  it('starts with the basic example: one decision with five conditions', () => {
    const [first] = EXAMPLES;
    const analysis = analyzeSource(first?.source ?? '', javascriptAdapter, 'masking');
    const result = analysis.decisions.get('d0');

    expect(first?.id).toBe('basic');
    expect(analysis.summary.decisions).toBe(1);
    expect(result?.conditionCount).toBe(5);
    expect(result?.uncoverable).toEqual([]);
    // Matches the description shown on the example card.
    expect(result?.rows).toHaveLength(7);
    expect(result?.selection.rows).toHaveLength(6);
  });
});
