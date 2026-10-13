export interface Customer {
  age: number;
  member: boolean;
  banned?: boolean;
}

export function isEligible(customer: Customer): boolean {
  return customer.age >= 18 && (customer.member || customer.age >= 65) && !customer.banned;
}
