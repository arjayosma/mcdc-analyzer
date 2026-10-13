import { isEligible, type Customer } from './rules';

export function discount(customer: Customer, total: number): number {
  if (isEligible(customer) && total > 100) {
    return 0.1;
  }
  return 0;
}

export function countFreeItems(prices: number[]): number {
  let free = 0;
  for (const price of prices) {
    if (price === 0 || price < 0.01) free++;
  }
  return free;
}

export function requirePositive(total: number): number {
  if (total < 0 || Number.isNaN(total)) {
    throw new RangeError('total must be positive');
  }
  return total;
}
