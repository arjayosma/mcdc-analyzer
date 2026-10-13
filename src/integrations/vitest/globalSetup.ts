// Vitest global setup (main process): merges every worker's results into
// mcdc-coverage.json when the test run ends.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { mergeEvaluations } from './merge';
import type { RawEvaluation } from './recorder';
import { state } from './state';

declare const __MCDC_VERSION__: string;

export default function setup(): () => void {
  return function teardown() {
    const { partsDir, output } = state;
    if (!partsDir || !output) return;
    const evaluations: RawEvaluation[] = [];
    for (const name of readdirSync(partsDir)) {
      if (name.endsWith('.json')) evaluations.push(...(JSON.parse(readFileSync(join(partsDir, name), 'utf8')) as RawEvaluation[]));
    }
    rmSync(partsDir, { recursive: true, force: true });
    state.partsDir = null;

    const coverage = mergeEvaluations(state.files, evaluations, {
      project: state.project,
      toolVersion: typeof __MCDC_VERSION__ === 'string' ? __MCDC_VERSION__ : 'dev',
      createdAt: new Date().toISOString(),
    });
    writeFileSync(output, `${JSON.stringify(coverage, null, 2)}\n`);
    const files = Object.keys(coverage.files).length;
    const reached = Object.values(coverage.files).filter((file) => file.evaluations.length > 0).length;
    console.log(
      `\n[mcdc-analyzer] MC/DC coverage for ${files} file${files === 1 ? '' : 's'} (${reached} reached) written to ${relative(process.cwd(), output) || output}` +
        '\n[mcdc-analyzer] Open it at https://arjayosma.github.io/mcdc-analyzer/ (drag the file onto the page).\n',
    );
  };
}
