/**
 * Help text shown in the app's Help dialog and in exported reports.
 * Inline markup: `code` and **bold** only; everything else is escaped.
 */
type HelpBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'steps' | 'list'; readonly items: readonly string[] }
  | { readonly kind: 'terms'; readonly items: readonly (readonly [string, string])[] };

export interface HelpSection {
  readonly id: string;
  readonly title: string;
  /** Short label for the jump links. */
  readonly short: string;
  /** Where the section is shown. */
  readonly audience: 'app' | 'report' | 'both';
  readonly blocks: readonly HelpBlock[];
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'purpose',
    short: 'Purpose',
    title: 'Purpose: why and when to use it',
    audience: 'both',
    blocks: [
      {
        kind: 'p',
        text: 'Line and branch coverage can report 100% while parts of a condition were never really tested. Take `if (user.isAdmin || (user.isOwner && !doc.locked))`: one test with an admin and one with a regular non-owner run every line and take both branches. But neither test ever checks that `isOwner` or `!doc.locked` matters, so a bug there (say, a missing `!`) would pass unnoticed.',
      },
      {
        kind: 'p',
        text: 'This tool shows, for every condition in your code, **which tests prove that condition actually affects the result**, and the **smallest set of tests** that does it for all of them. You get a concrete test list to write, instead of guessing which combinations matter.',
      },
      { kind: 'p', text: '**When to use it:**' },
      {
        kind: 'list',
        items: [
          '**Writing tests for logic-heavy code**: permissions, validation, eligibility rules, pricing, feature flags, state machines. Use the ★ rows as the test cases to write.',
          '**Reviewing a complex condition**: a high "MC/DC needs N" is a sign the logic is hard to test and may be worth simplifying.',
          '**Before refactoring a condition**: write the minimal set first, so the refactor is checked against every case that matters.',
          '**Finding redundant logic**: a condition that "cannot be shown" never changes the outcome. It is usually dead, duplicated or a bug.',
          '**Safety-critical or regulated work**: MC/DC is required for the most critical avionics software (DO-178C Level A) and highly recommended for ASIL D automotive software (ISO 26262). The exported report helps plan and review that testing.',
        ],
      },
      { kind: 'p', text: '**When it is not the right tool:**' },
      {
        kind: 'list',
        items: [
          'Measuring how much of your existing test suite covers the code. This tool works out the tests you **need**; it does not run tests. Use a runtime coverage tool for that.',
          'Code with only simple, single-condition branches, where ordinary branch coverage already tells you everything.',
        ],
      },
    ],
  },
  {
    id: 'what',
    short: 'MC/DC',
    title: 'What is MC/DC?',
    audience: 'both',
    blocks: [
      {
        kind: 'p',
        text: 'A **decision** is a boolean expression that controls flow, such as an `if` test, a loop condition, a ternary, or an `&&` / `||` expression. Its **conditions** are the parts joined by `&&` and `||` (a `!` stays part of its condition).',
      },
      {
        kind: 'p',
        text: '**Modified condition/decision coverage (MC/DC)** asks for tests that show **each condition independently changing the decision\'s outcome**. Each condition needs a pair of tests where that condition flips and the outcome flips with it. This tool finds those pairs and the smallest set of tests that covers every condition.',
      },
      {
        kind: 'p',
        text: 'The analysis is **static**: it reads the code and tells you which tests you need. It does not run your code or measure your existing tests.',
      },
    ],
  },
  {
    id: 'how',
    short: 'How to use',
    title: 'How to use it',
    audience: 'app',
    blocks: [
      {
        kind: 'steps',
        items: [
          'Paste or type JavaScript or TypeScript (JSX works too) in the editor, or pick **Load example…**. The analysis updates as you type. To analyze a whole codebase, use **Open folder…** or drag a folder onto the page (see "Projects" below).',
          'Pick a function from the **Function** dropdown above the graph. The panel below lists its decisions.',
          'Open a decision by clicking it in the list, clicking its hexagon in the graph, or clicking any underlined condition in the code.',
          'Click a row in **Test vectors** (or use the ↑/↓ keys) to trace that test. The code it runs through turns **bold with a red marker**, and its path is drawn in red in both graphs.',
          'Click a condition (C1, C2, …) to highlight the pair of tests that demonstrates it.',
          'Switch between **Masking** and **Unique-cause** to compare the two MC/DC variants.',
          'To measure real coverage, write calls in the **Tests** panel under the editor and press **Run** (see "Measuring coverage").',
          'Use **Export report** to download a self-contained HTML file you can share or attach to a review. With a project open, the report covers every file.',
        ],
      },
      { kind: 'p', text: 'Press `?` (when the editor is not focused) to open this help again.' },
    ],
  },
  {
    id: 'measure',
    title: 'Measuring coverage',
    short: 'Measure',
    audience: 'app',
    blocks: [
      {
        kind: 'p',
        text: 'The analysis says which tests you **need**. The **Tests** panel under the editor measures which ones your calls **actually run**. Write calls to the code, for example `test(\'admin can edit\', () => canEdit({ role: \'admin\' }))`, and press **Run** (⌘/Ctrl+Enter).',
      },
      {
        kind: 'list',
        items: [
          'The file\'s top-level functions and exports are in scope. In a project, files can import each other by relative path; npm packages are not available (JSX gets a small stand-in for React).',
          'Code runs in an isolated background worker and is stopped after 5 seconds, so an endless loop cannot freeze the page. TypeScript and JSX are converted to JavaScript first; decorators are not supported when running.',
          'Every evaluated decision is recorded and matched to its test vectors. A condition counts as covered once both tests of one of its independence pairs ran.',
          'Results show in the toolbar (**covered 4/11**), the code (green underline = covered, dashed amber = not yet), the decision list, the **Hits** column (rows still needed say **needed**), each condition (**✓ #1 ↔ #4** or **needs #1 ↔ #2**), the project overview and exported reports.',
          'Editing the code hides results that no longer line up; run again to refresh them. With measured results, the AI prompt asks only for the missing tests.',
        ],
      },
    ],
  },
  {
    id: 'projects',
    title: 'Projects (whole folders)',
    short: 'Projects',
    audience: 'app',
    blocks: [
      {
        kind: 'p',
        text: '**Open folder…** (or dragging a folder onto the page) analyzes every JavaScript/TypeScript file in it. Files are read in your browser only; nothing is uploaded.',
      },
      {
        kind: 'terms',
        items: [
          ['Overview', 'Totals for the project, the decisions that need the most tests, and every file with decisions. Click any row to open it.'],
          ['File list', 'The number on a file or folder is its decision count. An amber dot means a condition cannot be shown, red means syntax errors, blue means you edited the file here.'],
          ['Test files', 'Off by default, since `*.test.*`, `*.spec.*` and `__tests__/` usually are not the logic you want tests for. Tick **Test files** to include them.'],
          ['Skipped', 'Dependency, build, cache and version-control folders (`node_modules`, `dist`, `.git`, …), anything matched by `.gitignore` files, `*.d.ts`, minified files, files over 500 kB, and anything past 2,000 files. The **Skipped** list at the bottom of the file list says why for each.'],
          ['Edits', 'You can edit a project file to try changes; it is re-analyzed as you type. Edits stay in this browser tab and are **never written back** to your files.'],
        ],
      },
    ],
  },
  {
    id: 'using-report',
    short: 'Using the report',
    title: 'Using this report',
    audience: 'report',
    blocks: [
      {
        kind: 'list',
        items: [
          'Click a row in any **Test vectors** table, or use ↑/↓ on a focused row, to trace that test. The source it runs through turns **bold with a red marker**, and its path is drawn in red in the graphs.',
          'Click an underlined condition in the source to jump to its decision. In a report covering several files, the source pane shows the file of the decision you selected; use **Show source** on a file heading to switch to it.',
          'Use **Copy prompt** (or **Copy file prompt** / **Copy test prompt** for one file or decision) and paste it into an AI coding assistant to draft the required unit tests. The prompt includes the source code, so only use tools approved for it.',
          'Without JavaScript, or when printed, every table and graph is still complete; only the highlighting is missing.',
        ],
      },
    ],
  },
  {
    id: 'code',
    short: 'Code',
    title: 'Source code markings',
    audience: 'both',
    blocks: [
      {
        kind: 'terms',
        items: [
          ['Dotted underline', 'A condition that is part of a decision.'],
          ['Wavy amber underline', 'A condition that **cannot be shown** to independently affect its decision (see below).'],
          ['Blue background', 'Conditions of the selected decision.'],
          ['`C1·T`, `C2·F`, `C3·–`', 'The value each condition takes in the selected test; `–` means it is never evaluated because `&&` / `||` short-circuited.'],
          ['**Bold + red line marker**', 'Lines on the traced path for the selected test.'],
        ],
      },
    ],
  },
  {
    id: 'cfg',
    short: 'Graph',
    title: 'Control-flow graph',
    audience: 'both',
    blocks: [
      { kind: 'p', text: 'One graph per function, read top to bottom from the function name (entry) to **exit**.' },
      {
        kind: 'terms',
        items: [
          ['Hexagon', 'A branch decision (`if`, loop test). Its edges are labelled **T** and **F**.'],
          ['Rounded box', 'Straight-line statements that always run together.'],
          ['Dashed box', 'A `for…of` / `for…in` loop, `switch`, `do`, or `try` (structure without an MC/DC decision).'],
          ['Dashed edge', 'A loop going back to its condition.'],
          ['Blue number badge', 'Decisions inside that box that are expressions rather than branches, such as a ternary or `a && b` in a `return`.'],
          ['Red path', 'One example route a test with the selected outcome could take: the shortest one, without repeating loops. Other routes may exist.'],
          ['Faded box', 'Unreachable code (for example after a `return`).'],
        ],
      },
    ],
  },
  {
    id: 'flow',
    short: 'Condition flow',
    title: 'Condition flow',
    audience: 'both',
    blocks: [
      {
        kind: 'p',
        text: 'Shows how one decision is evaluated. Conditions **C1, C2, …** appear left to right in source order. Arrows above are taken when a condition is **true**, arrows below when it is **false**. Each arrow leads to the next condition evaluated, or straight to the **true** / **false** outcome, which shows how `&&` and `||` short-circuit.',
      },
      { kind: 'p', text: 'For the selected test, the conditions evaluated and the route taken are red; conditions it skips are faded.' },
    ],
  },
  {
    id: 'independence',
    short: 'Pairs',
    title: 'Independence pairs',
    audience: 'both',
    blocks: [
      {
        kind: 'terms',
        items: [
          ['`#1 ↔ #3`', 'The two tests chosen to demonstrate this condition: it is false in the first and true in the second, and the decision\'s outcome differs.'],
          ['`(+2 alt)`', 'Other valid pairs exist; the chosen one keeps the overall test set smallest.'],
          ['cannot be shown', 'No pair exists. The condition is usually redundant or coupled to another occurrence of itself, e.g. `b` in `(a && b) || a`, which always equals `a`. Review the logic: this often points to dead or simplifiable code.'],
        ],
      },
    ],
  },
  {
    id: 'vectors',
    short: 'Test vectors',
    title: 'Test vectors',
    audience: 'both',
    blocks: [
      {
        kind: 'terms',
        items: [
          ['Row (`#1`, `#2`, …)', 'One distinct test the decision can see: a combination of condition values that is actually possible with short-circuiting.'],
          ['T / F / –', 'Condition value in that test; `–` means "not evaluated", so any value works.'],
          ['Outcome', 'The decision\'s result for that test.'],
          ['★', 'The test is in the **minimal MC/DC set**, the tests you need to write.'],
          ['Shows', 'Which conditions this test helps demonstrate, as part of their chosen pair.'],
          ['MC/DC needs N', 'The size of the minimal set for this decision. The toolbar total adds this up across all decisions.'],
          ['Hits', 'Shown after a test run (and in reports that include one): how many times the tests ran this vector. **needed** marks rows still missing for full MC/DC.'],
        ],
      },
    ],
  },
  {
    id: 'modes',
    short: 'Modes',
    title: 'Masking vs unique-cause',
    audience: 'both',
    blocks: [
      {
        kind: 'terms',
        items: [
          ['Masking (default)', 'Other conditions may change between the two tests, as long as they cannot affect the outcome at that point. This is the form accepted by DO-178C, and it often needs fewer tests. `(a || b) && (c || d)` needs 4 tests for 4 conditions.'],
          ['Unique-cause', 'Only the condition under test may change; conditions skipped by short-circuiting are "don\'t care". It is stricter and often needs N+1 tests or more.'],
        ],
      },
    ],
  },
  {
    id: 'warnings',
    short: 'Warnings',
    title: 'Warnings',
    audience: 'both',
    blocks: [
      {
        kind: 'terms',
        items: [
          ['coupled conditions', 'The same condition appears more than once in a decision, so its occurrences always change together.'],
          ['N not shown', 'The number of conditions that cannot be shown independently.'],
          ['truncated', 'The decision has more than 1024 distinct tests. Results cover only the first 1024.'],
          ['set may not be minimal', 'The search for the smallest set hit its time budget. The set is valid but might not be the smallest.'],
        ],
      },
    ],
  },
  {
    id: 'limits',
    short: 'Good to know',
    title: 'Good to know',
    audience: 'both',
    blocks: [
      {
        kind: 'list',
        items: [
          'Repeated side-effect-free conditions (same text) are treated as the same condition. Calls like `next() && next()` are treated as independent.',
          '`??` and `?.` are not decisions; `a ?? b` counts as a single condition when used inside one.',
          'In the graph, `throw` goes straight to exit and a `catch` is reachable from the start of its `try`.',
          '`switch` cases are shown as branches, not MC/DC decisions.',
        ],
      },
    ],
  },
];

export function helpSectionsFor(audience: 'app' | 'report'): HelpSection[] {
  return HELP_SECTIONS.filter((section) => section.audience === 'both' || section.audience === audience);
}

/** Renders help sections to HTML. All text is escaped before markup is applied. */
export function renderHelpHtml(sections: readonly HelpSection[], headingLevel: 2 | 3 = 2): string {
  const h = `h${headingLevel}`;
  return sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) => {
          switch (block.kind) {
            case 'p':
              return `<p>${inline(block.text)}</p>`;
            case 'steps':
              return `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
            case 'list':
              return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
            case 'terms':
              return `<dl>${block.items.map(([term, description]) => `<dt>${inline(term)}</dt><dd>${inline(description)}</dd>`).join('')}</dl>`;
          }
        })
        .join('');
      return `<section class="help-section" id="help-${section.id}"><${h}>${inline(section.title)}</${h}>${blocks}</section>`;
    })
    .join('');
}

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
