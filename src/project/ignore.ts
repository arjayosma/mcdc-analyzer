/**
 * A .gitignore matcher covering the common syntax: comments, blank lines,
 * `!` negation, trailing `/` (directories only), leading or inner `/`
 * (anchored to the .gitignore's folder), `*`, `?`, `**` and `[...]`.
 *
 * As in git, a file inside an ignored directory cannot be re-included.
 */
interface Rule {
  /** Folder of the .gitignore that declared the rule ('' = project root). */
  readonly base: string;
  readonly negate: boolean;
  readonly directoryOnly: boolean;
  readonly regex: RegExp;
}

export class IgnoreMatcher {
  private readonly rules: Rule[] = [];

  /** Adds the rules of a .gitignore located in `base` (a folder path, '' for the root). */
  add(base: string, content: string): void {
    const normalizedBase = base.replace(/^\/+|\/+$/g, '');
    for (const line of content.split(/\r?\n/)) {
      const rule = parseRule(normalizedBase, line);
      if (rule) this.rules.push(rule);
    }
    // Rules from deeper .gitignore files take precedence, so they are checked last.
    this.rules.sort((a, b) => depth(a.base) - depth(b.base));
  }

  /** True when `path` (a file) or any folder above it is ignored. */
  ignores(path: string): boolean {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      if (this.matches(segments.slice(0, i).join('/'), true)) return true;
    }
    return this.matches(path, false);
  }

  /** True when this exact folder is ignored (not checking its parents). */
  ignoresDirectory(path: string): boolean {
    return this.matches(path, true);
  }

  private matches(path: string, isDirectory: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.base && !path.startsWith(`${rule.base}/`)) continue;
      const relative = rule.base ? path.slice(rule.base.length + 1) : path;
      if (rule.regex.test(relative)) ignored = !rule.negate;
    }
    return ignored;
  }
}

function depth(base: string): number {
  return base === '' ? 0 : base.split('/').length;
}

function parseRule(base: string, rawLine: string): Rule | null {
  let line = rawLine.replace(/(?<!\\)\s+$/, '');
  if (line === '' || line.startsWith('#')) return null;
  let negate = false;
  if (line.startsWith('!')) {
    negate = true;
    line = line.slice(1);
  } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
    line = line.slice(1);
  }
  const directoryOnly = line.endsWith('/');
  if (directoryOnly) line = line.replace(/\/+$/, '');
  if (line === '') return null;

  // A slash anywhere but the end anchors the pattern to the .gitignore's folder.
  const anchored = line.includes('/');
  line = line.replace(/^\/+/, '');
  const body = globToRegex(line);
  const regex = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`);
  return { base, negate, directoryOnly, regex };
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? '';
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const followedBySlash = glob[i + 2] === '/';
        if (atSegmentStart && followedBySlash) {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let set = glob.slice(i + 1, close);
        if (set.startsWith('!')) set = `^${set.slice(1)}`;
        out += `[${set.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (char === '\\' && i + 1 < glob.length) {
      out += escapeRegex(glob[i + 1] ?? '');
      i += 1;
    } else {
      out += escapeRegex(char);
    }
  }
  return out;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
