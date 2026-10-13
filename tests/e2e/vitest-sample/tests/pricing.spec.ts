import { describe, expect, it } from 'vitest';
import { countFreeItems, discount, requirePositive } from '../src/pricing';

describe('discount', () => {
  it('gives members over 18 a discount on big orders', () => {
    expect(discount({ age: 30, member: true }, 150)).toBe(0.1);
  });

  it('gives no discount to minors', () => {
    expect(discount({ age: 16, member: true }, 150)).toBe(0);
  });

  it('gives no discount on small orders', () => {
    expect(discount({ age: 30, member: true }, 50)).toBe(0);
  });
});

it('counts free items', () => {
  expect(countFreeItems([0, 5, 0.001, 3])).toBe(2);
});

it('keeps original line numbers in stack traces', () => {
  try {
    requirePositive(-1);
    expect.unreachable();
  } catch (error) {
    // Instrumentation adds code; source maps keep the reported location on the original line.
    expect((error as Error).stack).toMatch(/src\/pricing\.ts:20:\d+/);
  }
});
