import { describe, expect, it } from 'vitest';
import { IgnoreMatcher } from '../../src/project/ignore';

const matcher = (rules: Record<string, string>) => {
  const ignore = new IgnoreMatcher();
  for (const [base, content] of Object.entries(rules)) ignore.add(base, content);
  return ignore;
};

describe('IgnoreMatcher', () => {
  it('matches plain names at any depth and ignores comments and blank lines', () => {
    const ignore = matcher({ '': '# comment\n\n*.log\nsecrets.ts\n' });

    expect(ignore.ignores('debug.log')).toBe(true);
    expect(ignore.ignores('src/deep/app.log')).toBe(true);
    expect(ignore.ignores('src/secrets.ts')).toBe(true);
    expect(ignore.ignores('src/app.ts')).toBe(false);
  });

  it('anchors patterns that contain a slash to the .gitignore folder', () => {
    const ignore = matcher({ '': '/config.ts\nsrc/generated/\n' });

    expect(ignore.ignores('config.ts')).toBe(true);
    expect(ignore.ignores('src/config.ts')).toBe(false);
    expect(ignore.ignores('src/generated/api.ts')).toBe(true);
    expect(ignore.ignores('lib/src/generated/api.ts')).toBe(false);
  });

  it('applies trailing-slash rules to folders only, including everything inside', () => {
    const ignore = matcher({ '': 'tmp/\n' });

    expect(ignore.ignores('tmp/a.ts')).toBe(true);
    expect(ignore.ignores('src/tmp/b.ts')).toBe(true);
    expect(ignore.ignores('src/tmp')).toBe(false);
  });

  it('supports ** in leading, middle and trailing positions', () => {
    const ignore = matcher({ '': '**/fixtures\nsrc/**/mocks/*.ts\nlogs/**\n' });

    expect(ignore.ignores('a/b/fixtures/data.ts')).toBe(true);
    expect(ignore.ignores('src/mocks/x.ts')).toBe(true);
    expect(ignore.ignores('src/a/b/mocks/x.ts')).toBe(true);
    expect(ignore.ignores('logs/2026/today.ts')).toBe(true);
    expect(ignore.ignores('src/a/mocks/deeper/x.ts')).toBe(false);
  });

  it('handles ? and character classes', () => {
    const ignore = matcher({ '': 'file?.ts\nv[0-9].ts\nx[!a].ts\n' });

    expect(ignore.ignores('file1.ts')).toBe(true);
    expect(ignore.ignores('file12.ts')).toBe(false);
    expect(ignore.ignores('v7.ts')).toBe(true);
    expect(ignore.ignores('xb.ts')).toBe(true);
    expect(ignore.ignores('xa.ts')).toBe(false);
  });

  it('re-includes files with ! but never inside an ignored folder', () => {
    const ignore = matcher({ '': '*.gen.ts\n!keep.gen.ts\nout/\n!out/important.ts\n' });

    expect(ignore.ignores('a.gen.ts')).toBe(true);
    expect(ignore.ignores('keep.gen.ts')).toBe(false);
    expect(ignore.ignores('out/important.ts')).toBe(true);
  });

  it('scopes nested .gitignore rules to their folder and lets them override parents', () => {
    const ignore = matcher({ '': '*.local.ts\n', 'packages/app': '!*.local.ts\nlegacy/\n' });

    expect(ignore.ignores('src/x.local.ts')).toBe(true);
    expect(ignore.ignores('packages/app/x.local.ts')).toBe(false);
    expect(ignore.ignores('packages/app/legacy/old.ts')).toBe(true);
    expect(ignore.ignores('legacy/old.ts')).toBe(false);
  });

  it('treats escaped characters literally', () => {
    const ignore = matcher({ '': '\\#notes.ts\n\\!bang.ts\nweird\\*.ts\n' });

    expect(ignore.ignores('#notes.ts')).toBe(true);
    expect(ignore.ignores('!bang.ts')).toBe(true);
    expect(ignore.ignores('weird*.ts')).toBe(true);
    expect(ignore.ignores('weirdo.ts')).toBe(false);
  });
});
