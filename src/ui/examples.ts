export interface Example {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'basic',
    title: 'Basic: 5 conditions',
    description: 'One if with five conditions: 7 possible test cases, and MC/DC needs 6 of them.',
    source: `function canCheckout(cart, user) {
  if (cart.items.length > 0 && user.loggedIn && (user.verified || cart.total < 50) && !cart.locked) {
    return 'checkout';
  }
  return 'blocked';
}
`,
  },
  {
    id: 'access',
    title: 'Access control',
    description: 'Nested if/else, a loop with early return and a ternary.',
    source: `function canAccess(user, resource, now) {
  if (!user || user.suspended) {
    return false;
  }

  if ((user.role === 'admin' || user.role === 'owner') && !resource.locked) {
    return true;
  }

  for (const grant of user.grants) {
    if (grant.resourceId === resource.id && (grant.expiresAt > now || grant.permanent)) {
      return true;
    }
  }

  const fallback = resource.public ? 'read' : 'none';
  return fallback === 'read' && resource.allowAnonymous;
}
`,
  },
  {
    id: 'masking',
    title: 'Masking beats N+1',
    description: '(a || b) && (c || d): masking MC/DC needs 4 tests for 4 conditions.',
    source: `function shouldShip(order) {
  if ((order.paid || order.invoiced) && (order.inStock || order.backorderOk)) {
    ship(order);
  } else {
    hold(order);
  }
}
`,
  },
  {
    id: 'coupled',
    title: 'Coupled conditions',
    description: 'A repeated condition makes another one redundant and impossible to show.',
    source: `function isEligible(age, member) {
  return (age >= 18 && member) || age >= 18;
}
`,
  },
  {
    id: 'loops',
    title: 'Loops & switch',
    description: 'while, do…while, for, switch fall-through and labelled break.',
    source: `function process(queue, limit) {
  let handled = 0;
  outer: while (queue.length > 0 && handled < limit) {
    const job = queue.shift();
    switch (job.type) {
      case 'skip':
        continue;
      case 'stop':
        break outer;
      case 'retry':
      case 'run':
        let attempts = 0;
        do {
          attempts++;
        } while (!job.run() && attempts < 3);
        break;
      default:
        log(job);
    }
    handled++;
  }
  return handled;
}
`,
  },
  {
    id: 'typescript',
    title: 'TypeScript + JSX',
    description: 'Type assertions, non-null assertions and decisions inside JSX.',
    source: `interface Props { loading: boolean; error?: Error; items: string[] }

export function List({ loading, error, items }: Props) {
  const empty = !loading && !error && items.length === 0;
  return (
    <div>
      {loading && !error && <Spinner />}
      {empty ? <EmptyState /> : items.map((item) => <Row key={item} label={item} />)}
    </div>
  );
}
`,
  },
];
