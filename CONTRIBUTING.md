# Contributing

Thanks for helping! This guide gets you from clone to pull request quickly.

## Setup

```bash
git clone https://github.com/arjayosma/mcdc-analyzer.git
cd mcdc-analyzer
nvm use          # optional: Node 22 from .nvmrc (20.19+ works)
npm install
npm run dev      # http://localhost:5173
```

Before you push, run the same checks as CI:

```bash
npm run check    # typecheck + lint + tests
npm run build    # make sure the production build still works
```

## Workflow

1. Open an issue first for larger changes, so we can agree on the approach.
2. Create a branch, make focused commits, and keep unrelated refactors out.
3. Add or update tests for behaviour changes; a bug fix should come with a test that fails without it.
4. Open a pull request. The template has a short checklist; screenshots help for UI changes.

Every push to `main` runs CI and redeploys the [live demo](https://arjayosma.github.io/mcdc-analyzer/).

## Where things live

| Folder | What's there | Tests |
| --- | --- | --- |
| `src/engine/` | MC/DC core: truth tables, independence pairs, minimal sets. Pure functions over a boolean tree. | `tests/engine/` (includes randomized property tests) |
| `src/adapters/javascript/` | Babel-based parser: decisions, conditions, control-flow graphs | `tests/adapters/javascript/` |
| `src/model/types.ts` | The language-neutral `ProgramModel` and `LanguageAdapter` interface | |
| `src/coverage/` | Instrumentation, Web Worker runner, coverage matching | `tests/coverage/` (runs instrumented code under Node) |
| `src/project/` | Folder loading, `.gitignore` matching, file selection, summaries | `tests/project/` |
| `src/report/` | HTML report, AI prompt, the report's inline `runtime.js` | `tests/report/` |
| `src/ui/` | Views and the app shell | `tests/ui/` for pure helpers; views are checked in the browser |
| `src/styles/` | Design tokens and component styles shared by the app and the report | |

## Conventions

- **TypeScript, strict.** Prefer the narrowest types; avoid `as` casts unless crossing an untyped boundary.
- **No UI framework.** Views build DOM with the small `h()` / `s()` helpers in `src/ui/dom.ts` and react to the shared `Store`.
- **Keep logic out of views.** Anything testable (analysis, coverage, file selection, report HTML, prompt text) lives in a pure module with Vitest tests. Views only render state.
- **Shared wording and styles.** User-facing labels live in `src/ui/labels.ts` and help text in `src/ui/helpContent.ts`, so the app and the exported report stay consistent. Colours come from CSS variables in `src/styles/tokens.css` (light and dark).
- **Red means "path".** The selected test's route uses `--path`; don't reuse red for other meanings.
- **The report's `runtime.js` is plain JavaScript** inlined into exported files, and it re-implements `assembleTestPrompt` from `src/report/testPrompt.ts`. If you change how prompts are assembled, change both and check **Copy prompt** in an exported report: tests cover the TypeScript side and that the page's source text rebuilds the prompt exactly, but not the inline script itself.
- **Examples are tested.** Every entry in `src/ui/examples.ts` must parse cleanly (`tests/ui/examples.test.ts`).

## Adding a language

The engine, UI, reports and project view never look at syntax, so a new language only needs a parser that produces the program model.

1. Create `src/adapters/<language>/` implementing `LanguageAdapter` from `src/model/types.ts`:
   - `decisions`: each with a `ConditionNode` tree (`and` / `or` / `not` / `condition` leaves). Leaves are numbered `0..n-1` in source order; leaves that are the same condition share a `group`.
   - `conditions`: the text and source range (character offsets) of every leaf.
   - `functions`: one control-flow graph per function. Nodes carry source ranges, and branch nodes reference their `decisionId`.
2. Mirror `tests/adapters/javascript/` with tests for your parser.
3. Wire the adapter into `src/ui/App.ts` (currently it always uses `javascriptAdapter`); choosing by file extension is a natural next step.

[tree-sitter](https://tree-sitter.github.io/) compiled to WebAssembly is a good fit for parsing several languages in the browser. Measured coverage (`src/coverage/`) runs JavaScript, so other languages would get the static analysis first.

## Reporting bugs

Use the bug report template and include the smallest code snippet that reproduces the problem. For wrong MC/DC results, say which decision and what you expected (the test vectors or pairs).
