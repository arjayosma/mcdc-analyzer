import { transform as sucrase } from 'sucrase';
import type { Transform } from './runtime';

/**
 * Strips TypeScript and JSX and turns ESM into CommonJS for the runner.
 * Modern syntax is kept as-is (the browser runs it natively).
 */
export const sucraseTransform: Transform = (code, path) =>
  sucrase(code, {
    transforms: ['typescript', 'jsx', 'imports'],
    disableESTransforms: true,
    production: true,
    filePath: path,
  }).code;
