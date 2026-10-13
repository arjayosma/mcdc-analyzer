// Vitest setup file (runs in each worker, before each test file).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach } from 'vitest';
import { recorder } from './runtime';
import { PARTS_ENV } from './state';

interface TaskLike {
  readonly name: string;
  readonly suite?: TaskLike & { readonly filepath?: string };
}

/** "suite > nested suite > test", without the file-level suite. */
function fullName(task: TaskLike): string {
  const names = [task.name];
  for (let suite = task.suite; suite && !suite.filepath; suite = suite.suite) names.unshift(suite.name);
  return names.filter(Boolean).join(' > ');
}

let written = 0;

beforeEach((context) => recorder.setTest(fullName(context.task as TaskLike)));
afterEach(() => recorder.setTest(null));
afterAll(() => {
  const dir = process.env[PARTS_ENV];
  const evaluations = recorder.drain();
  if (!dir || evaluations.length === 0) return;
  written++;
  writeFileSync(join(dir, `${process.pid}-${Date.now()}-${written}.json`), JSON.stringify(evaluations));
});
