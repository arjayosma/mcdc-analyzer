import { describe, expect, it } from 'vitest';
import { parseJavaScript } from '../../../src/adapters/javascript';
import { analyzeDecision } from '../../../src/engine';

const conditionTexts = (source: string) =>
  parseJavaScript(source).decisions.map((decision) => decision.conditions.map((condition) => condition.text));

describe('javascript adapter: decisions', () => {
  it('splits an if test into conditions with exact source ranges', () => {
    const source = 'if ((user.active && user.age >= 18) || override) grant();';
    const { decisions, diagnostics } = parseJavaScript(source);

    expect(diagnostics).toEqual([]);
    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision?.kind).toBe('if');
    expect(decision?.text).toBe('(user.active && user.age >= 18) || override');
    expect(decision?.conditions.map((c) => source.slice(c.range.start, c.range.end))).toEqual([
      'user.active',
      'user.age >= 18',
      'override',
    ]);
    expect(decision?.tree).toEqual({
      kind: 'or',
      left: {
        kind: 'and',
        left: { kind: 'condition', index: 0, group: 0 },
        right: { kind: 'condition', index: 1, group: 1 },
      },
      right: { kind: 'condition', index: 2, group: 2 },
    });
  });

  it('recognises every decision kind and ignores non-boolean operators', () => {
    const source = `
      while (i < n && !done) i++;
      do { step(); } while (retry || pending);
      for (let j = 0; j < n; j++) {}
      for (;;) { break; }
      const label = ok ? 'yes' : 'no';
      const fallback = value ?? defaultValue;
      return enabled && visible;
    `;
    const { decisions } = parseJavaScript(source);

    expect(decisions.map((decision) => [decision.kind, decision.text])).toEqual([
      ['while', 'i < n && !done'],
      ['do-while', 'retry || pending'],
      ['for', 'j < n'],
      ['ternary', 'ok'],
      ['logical', 'enabled && visible'],
    ]);
  });

  it('treats negation as part of the decision, not a separate condition', () => {
    const [decision] = parseJavaScript('if (!(a || !b)) {}').decisions;

    expect(decision?.conditions.map((c) => c.text)).toEqual(['a', 'b']);
    expect(decision?.tree).toEqual({
      kind: 'not',
      operand: {
        kind: 'or',
        left: { kind: 'condition', index: 0, group: 0 },
        right: { kind: 'not', operand: { kind: 'condition', index: 1, group: 1 } },
      },
    });
  });

  it('extracts decisions nested inside condition leaves as separate decisions', () => {
    expect(conditionTexts('if (isValid(x && y) || (a ? b : c)) {}')).toEqual([
      ['isValid(x && y)', 'a ? b : c'],
      ['x', 'y'],
      ['a'],
    ]);
  });

  it('couples repeated side-effect-free conditions but not repeated calls', () => {
    const [pure, calls] = parseJavaScript('if (a.b && c || a.b) {}\nif (next() && next()) {}').decisions;

    expect(pure?.conditions.map((c) => c.group)).toEqual([0, 1, 0]);
    expect(calls?.conditions.map((c) => c.group)).toEqual([0, 1]);
  });

  it('parses TypeScript and looks through type-only wrappers', () => {
    const { decisions, diagnostics } = parseJavaScript(
      'function check(u: User): boolean { return ((u as Admin).isAdmin && u.token!) as boolean; }',
    );

    expect(diagnostics).toEqual([]);
    expect(decisions[0]?.conditions.map((c) => c.text)).toEqual(['(u as Admin).isAdmin', 'u.token!']);
  });

  it('parses JSX and finds decisions inside it', () => {
    const { decisions, diagnostics } = parseJavaScript('const View = () => <div>{loading && !error && <Spinner />}</div>;');

    expect(diagnostics).toEqual([]);
    expect(decisions[0]?.conditions.map((c) => c.text)).toEqual(['loading', 'error', '<Spinner />']);
  });

  it('assigns decisions to their innermost function and names functions', () => {
    const source = `
      function outer(p) {
        const isSet = (x) => x !== undefined && x !== null;
        if (p) return isSet(p);
      }
      class Gate { open(a, b) { return a || b; } get closed() { return !this.isOpen; } }
      const api = { ping: function () { return up && ready; } };
    `;
    const { functions, decisions } = parseJavaScript(source);
    const ownerName = (id: string) =>
      functions.find((fn) => fn.id === decisions.find((d) => d.id === id)?.functionId)?.name;

    expect(functions.map((fn) => fn.name)).toEqual([
      // Kept because the class and const declarations are top-level code.
      '(top level)',
      'outer',
      'isSet',
      'open',
      'get closed',
      'ping',
    ]);
    expect(decisions.map((d) => [d.text, ownerName(d.id)])).toEqual([
      ['x !== undefined && x !== null', 'isSet'],
      ['p', 'outer'],
      ['a || b', 'open'],
      ['up && ready', 'ping'],
    ]);
  });

  it('keeps the top-level pseudo-function only when there is top-level code', () => {
    expect(parseJavaScript('function f(a) { return a && 1; }').functions.map((fn) => fn.name)).toEqual(['f']);
    expect(parseJavaScript('if (a) go();').functions.map((fn) => fn.name)).toEqual(['(top level)']);
  });

  it('reports syntax errors as diagnostics with a position', () => {
    const result = parseJavaScript('if (a && {');

    expect(result.functions).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.range).toBeDefined();
  });

  it('produces trees the engine can analyze', () => {
    const { decisions } = parseJavaScript('if ((a && b) || c) {} while (x || y && z) {}');

    expect(decisions.map((d) => analyzeDecision(d.tree).selection.rows.length)).toEqual([4, 4]);
  });

  it('parses TypeScript legacy decorators (Angular, NestJS, TypeORM style)', () => {
    const { decisions, diagnostics, functions } = parseJavaScript(`
      @Controller('orders')
      export class OrdersController {
        @Inject() private readonly service: OrderService;

        @Get(':id')
        find(@Param('id') id: string, @Query() q: Query) {
          if (q.includeArchived && !this.service.readOnly) return this.service.all(id);
          return this.service.find(id);
        }
      }
    `);

    expect(diagnostics).toEqual([]);
    expect(functions.map((fn) => fn.name)).toContain('find');
    expect(decisions.map((d) => d.text)).toEqual(['q.includeArchived && !this.service.readOnly']);
  });

  it('parses standard decorators, including after export and on accessors', () => {
    const { decisions, diagnostics } = parseJavaScript(`
      export @observable class Store {
        @tracked accessor count = 0;
        @action inc(by) { if (by > 0 && by < 10) this.count += by; }
      }
    `);

    expect(diagnostics).toEqual([]);
    expect(decisions.map((d) => d.text)).toEqual(['by > 0 && by < 10']);
  });

  it('still reports genuine syntax errors in decorated code', () => {
    const { diagnostics } = parseJavaScript('@Component({})\nexport class A { m() { if (a && { } }');

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).not.toMatch(/decorators/);
  });
});

