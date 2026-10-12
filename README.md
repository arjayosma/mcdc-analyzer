# MC/DC Analyzer

A browser-based **modified condition/decision coverage (MC/DC)** analyzer. Paste JavaScript or TypeScript, or open a whole project folder, and it works out, for every decision in the code, which tests prove that each condition independently affects the outcome, and the smallest set of tests that does it for all of them.

It runs entirely in the browser as a static site. Nothing is uploaded anywhere.

## Why

Line and branch coverage can report 100% while parts of a condition were never really tested. In `if (user.isAdmin || (user.isOwner && !doc.locked))`, two tests (an admin, and a regular non-owner) run every line and take both branches. Neither one checks that `isOwner` or `!doc.locked` matters.

MC/DC closes that gap. Use this tool to:

- **Write tests for logic-heavy code** such as permissions, validation, pricing and feature flags, using the required tests as your test cases.
- **Review complex conditions.** A large "MC/DC needs N" means the logic is hard to test and may be worth simplifying.
- **Refactor safely.** Write the minimal set before changing a condition.
- **Find redundant logic.** Conditions that "cannot be shown" never change the outcome.
- **Plan testing for safety-critical work.** MC/DC is required for DO-178C Level A avionics software and highly recommended for ISO 26262 ASIL D.

The analysis tells you which tests you **need**. The built-in **Tests** panel then measures which ones your calls **actually run**, so you can see your real MC/DC coverage and what is still missing.

## Features

- **Decision analysis:** `if`, `while`, `do…while`, `for`, ternaries, and `&&` / `||` anywhere, including JSX and TypeScript.
- **Short-circuit-aware truth tables:** conditions that are never evaluated are marked "don't care" (`–`).
- **Two MC/DC variants:** masking (the default, as accepted by DO-178C) and unique-cause.
- **Minimal test sets:** chosen by an exact search, with a greedy fallback for very large decisions.
- **Linked views:**
  - source code, with conditions underlined and the traced path **bolded with a red marker**
  - a control-flow graph for each function, with the example path drawn in red
  - a condition graph for each decision, showing how `&&` / `||` short-circuit
  - the condition pairs, and test vectors where ★ marks the minimal set
- **Measured coverage:** write calls in the **Tests** panel and press Run. The code is instrumented, run in an isolated Web Worker (stopped after 5 s), and every decision evaluation is matched to its test vectors. Coverage shows in the code, the decision panel (**Hits**, covered/needed pairs), the toolbar, the project overview and exported reports, and the AI prompt then asks only for the missing tests.
- **Whole-project analysis:** open a folder (or drag one onto the page) to get a file tree with per-file decision counts, a project overview with the decisions needing the most tests, and in-memory editing. Dependency, build and cache folders, `.gitignore`d paths, `*.d.ts`, minified files and (by default) test files are skipped, each with a reason.
- **Standalone HTML report:** one file you can share, with click-to-trace, a "How to read this report" section, and an **AI test-generation prompt** (whole report or per decision) for turning the required tests into runnable unit tests.
- **Built-in help:** the **Help** button, or the `?` key.

## Getting started

Requires **Node.js 20.19+** (Node 22 recommended; see `.nvmrc`). Vite 7 fails on older Node versions, e.g. with `crypto.hash is not a function` when building.

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # http://localhost:5173
```

Paste code into the editor, pick **Load example…**, or use **Open folder…** for a whole project. Then click a decision and a test row to trace it.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck and build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Run the unit tests once (Vitest) |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

### Deploying

`npm run build` produces a fully static `dist/` with relative asset paths, so it can be served from any static host or sub-path.

## How it works

```
source ──► language adapter ──► program model ──► MC/DC engine ──► UI / HTML report
           (Babel for JS/TS)    decisions,         truth table,
                                conditions,        pairs,
                                CFG, ranges        minimal set
```

1. **Adapter** (`src/adapters/javascript`): parses the code with `@babel/parser`, and finds each decision and its condition tree with exact source ranges. It also builds a statement-level control-flow graph for each function. Repeated side-effect-free conditions are treated as the same condition ("coupled"); calls are not.
2. **Engine** (`src/engine`): works only on a language-neutral boolean tree. It builds the short-circuit truth table by exploring branches rather than all 2ⁿ combinations, finds independence pairs for the chosen MC/DC variant, and selects the minimal test set (branch-and-bound with a step budget).
3. **UI** (`src/ui`): CodeMirror for the source, elkjs to lay out the control-flow graph, and hand-drawn SVG for the condition graphs. A small store keeps every view in sync.
4. **Coverage** (`src/coverage`): wraps every decision and condition in recording calls at their exact source positions (values and short-circuiting are unchanged), converts TypeScript/JSX/ESM with Sucrase, runs the code with the user's `test()` calls in a Web Worker, and matches each recorded evaluation to a truth-table row.
5. **Report** (`src/report`): renders the same SVGs and help content into a single HTML file. A small inline script adds click-to-trace and the copy-prompt buttons.

## Project structure

```
src/
  adapters/javascript/   Babel AST → decisions, condition trees, CFG
  model/types.ts         Language-neutral program model + LanguageAdapter interface
  engine/                Truth tables, independence pairs, minimal set, condition graph
  cfg/                   CFG layout (elkjs) and example-path finding
  coverage/              Instrumentation, Web Worker test runner, measured coverage
  analysis.ts            Runs the engine over every decision in a program
  ui/                    App shell, code pane, CFG view, decision panel, help
  project/               Folder loading, .gitignore matching, file selection, project summary
  report/                HTML report builder, AI test prompt, inline runtime script
  styles/                Shared design tokens and component styles (app + report)
tests/                   Vitest unit tests (engine, adapter, paths, project, report, prompt, help)
```

## Adding a language

The engine and UI never look at language syntax. To support another language:

1. Implement `LanguageAdapter` from `src/model/types.ts`. `parse(source)` must return a `ProgramModel`: functions with control-flow graphs, and decisions with condition trees whose leaves are numbered `0..n-1` in source order, plus source ranges.
2. Add tests alongside `tests/adapters/javascript`.
3. Wire the adapter into `src/ui/App.ts`.

tree-sitter (via WebAssembly) is the natural choice for adding several languages, Java included.

## Known limitations

- Measuring coverage runs your calls in the browser: npm packages are not available (only project files, plus a small React stand-in for JSX), decorators are not supported when running (Sucrase limitation), and it does not run your existing Jest/Vitest suites.
- Projects are analyzed on the main thread in small time slices; very large folders (thousands of files) take a while, and are capped at 2,000 files.
- `.gitignore` support covers the common syntax (`*`, `?`, `**`, `[...]`, `!`, anchoring, folder-only rules) but not every edge case of git's matcher.
- Edits to project files stay in the browser tab; they are never written back to disk.
- In the control-flow graph, `throw` goes straight to exit, and a `catch` is reachable from the start of its `try`.
- `switch` cases are shown as branches, not MC/DC decisions; `??` and `?.` are not decisions.
- Truth tables are capped at 1024 rows per decision (flagged as "truncated").
- The main bundle is about 820 kB (256 kB gzipped). elkjs (1.4 MB) loads only when the first graph is drawn.

## Troubleshooting

- **`npm install` fails with `Cannot read properties of null (reading 'edgesOut')`:** this is a bug in npm 10.9. Run the install with npm 11 instead: `npx npm@11 install`.
