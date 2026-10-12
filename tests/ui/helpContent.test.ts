import { describe, expect, it } from 'vitest';
import { helpSectionsFor, renderHelpHtml, type HelpSection } from '../../src/ui/helpContent';

describe('help content', () => {
  it('shows usage steps in the app and report instructions in the report', () => {
    const app = helpSectionsFor('app').map((section) => section.id);
    const report = helpSectionsFor('report').map((section) => section.id);

    expect(app).toContain('how');
    expect(app).toContain('projects');
    expect(report).not.toContain('projects');
    expect(app).not.toContain('using-report');
    expect(report).toContain('using-report');
    expect(report).not.toContain('how');
    expect(app[0]).toBe('purpose');
    expect(report[0]).toBe('purpose');
    for (const shared of ['purpose', 'what', 'cfg', 'flow', 'independence', 'vectors', 'modes', 'warnings']) {
      expect(app).toContain(shared);
      expect(report).toContain(shared);
    }
  });

  it('escapes text before applying code and bold markup', () => {
    const section: HelpSection = {
      id: 'x',
      title: 'Title <b>',
      short: 'T',
      audience: 'both',
      blocks: [
        { kind: 'p', text: 'Use `a && b` and **care** with <script>' },
        { kind: 'terms', items: [['`C1·T`', 'value']] },
      ],
    };

    expect(renderHelpHtml([section], 3)).toBe(
      '<section class="help-section" id="help-x"><h3>Title &lt;b&gt;</h3>' +
        '<p>Use <code>a &amp;&amp; b</code> and <strong>care</strong> with &lt;script&gt;</p>' +
        '<dl><dt><code>C1·T</code></dt><dd>value</dd></dl></section>',
    );
  });
});
