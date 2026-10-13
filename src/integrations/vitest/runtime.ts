// Imported by every instrumented module and by the worker setup file. The
// recorder lives on globalThis so all module instances in a worker share it,
// even when Vitest re-evaluates modules for each test file.
import { createRecorder, type Recorder } from './recorder';

const KEY = '__mcdcAnalyzerRecorder';
const scope = globalThis as typeof globalThis & { [KEY]?: Recorder };

export const recorder: Recorder = (scope[KEY] ??= createRecorder());
