// Inlined into exported reports (not bundled into the app). Adds click-to-trace:
// selecting a test row bolds the source its path runs through (red marker) and
// draws that path in red in the function's CFG and the decision's condition flow.
// Data comes from the #report-data JSON built by buildReport.ts.
(() => {
  'use strict';

  const dataElement = document.getElementById('report-data');
  if (!dataElement) return;
  const data = JSON.parse(dataElement.textContent || '{}');
  const all = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const sourcePane = document.querySelector('.source-pane');
  const sourcePath = document.querySelector('.source-path');

  // Multi-file reports show one file's source at a time.
  function showSource(fileKey) {
    for (const element of all('.source[data-file]')) element.hidden = element.getAttribute('data-file') !== fileKey;
    const info = data.files && data.files[fileKey];
    if (sourcePath && info) sourcePath.textContent = info.path || '';
  }

  function setMarker(group, onPath) {
    const svg = group.closest('svg');
    const path = group.querySelector('path');
    if (!svg || !path) return;
    const prefix = svg.getAttribute('data-arrow');
    path.setAttribute('marker-end', `url(#${prefix}-arrow${onPath ? '-path' : ''})`);
    // Draw highlighted edges last so they sit above crossing edges.
    if (onPath && group.parentNode) group.parentNode.appendChild(group);
  }

  function clear() {
    for (const element of all('.on-path')) {
      element.classList.remove('on-path');
      if (element.matches('.cfg-edge, .cg-edge')) setMarker(element, false);
    }
    for (const element of all('.cg-entry')) {
      element.setAttribute('marker-end', `url(#${element.closest('svg').getAttribute('data-arrow')}-arrow)`);
    }
    for (const element of all('.is-selected, .is-skipped, .is-active')) {
      element.classList.remove('is-selected', 'is-skipped', 'is-active');
    }
    for (const element of all('tr[aria-selected="true"]')) element.setAttribute('aria-selected', 'false');
    for (const element of all('.src-cond.is-decision')) {
      element.classList.remove('is-decision', 'is-true', 'is-false', 'is-none');
    }
    for (const element of all('.src-cond[data-tag]')) element.removeAttribute('data-tag');
  }

  // `decisionId` is a report-wide key such as `F0-d3`.
  function select(decisionId, rowId, scroll) {
    const decision = data.decisions[decisionId];
    const row = decision && decision.rows[rowId];
    if (!row) return;
    clear();
    showSource(decision.file);

    const article = document.getElementById(`decision-${decisionId}`);
    if (article) article.classList.add('is-active');
    const tr = article && article.querySelector(`tr[data-row="${rowId}"]`);
    if (tr) {
      tr.classList.add('is-selected');
      tr.setAttribute('aria-selected', 'true');
    }

    // Source: bold path lines with the red marker, colour this decision's conditions.
    const path = decision.paths[row.outcome ? 'true' : 'false'];
    for (const line of path ? path.lines : []) {
      const element = document.getElementById(`${decision.file}-L${line}`);
      if (element) element.classList.add('on-path');
    }
    for (let index = 0; index < decision.conditionCount; index++) {
      const key = `${decisionId}:${index}`;
      const value = row.values[index];
      const valueClass = value === null ? 'is-none' : value ? 'is-true' : 'is-false';
      for (const element of all(`.src-cond[data-c~="${key}"]`)) element.classList.add('is-decision', valueClass);
      for (const element of all(`.src-cond[data-ends~="${key}"]`)) {
        element.setAttribute('data-tag', `C${index + 1}·${value === null ? '–' : value ? 'T' : 'F'}`);
      }
    }

    // Function CFG: red path, selected host node.
    const cfg = document.querySelector(`[data-file-section="${decision.file}"] svg.cfg-svg[data-fn="${decision.fn}"]`);
    if (cfg && path) {
      const nodes = new Set(path.nodes);
      const edges = new Set(path.edges.map(String));
      for (const node of all('.cfg-node', cfg)) {
        const id = node.getAttribute('data-node');
        if (nodes.has(id)) node.classList.add('on-path');
        if (id === decision.host) node.classList.add('is-selected');
      }
      for (const edge of all('.cfg-edge', cfg)) {
        if (edges.has(edge.getAttribute('data-edge'))) {
          edge.classList.add('on-path');
          setMarker(edge, true);
        }
      }
    }

    // Condition flow: the evaluated conditions, the branch each took, the outcome.
    const graph = article && article.querySelector('svg.condition-graph');
    if (graph) {
      const visited = new Set(row.order);
      for (const node of all('.cg-node', graph)) {
        const index = Number(node.getAttribute('data-cond'));
        node.classList.add(visited.has(index) ? 'on-path' : 'is-skipped');
      }
      for (const index of row.order) {
        const edge = graph.querySelector(`.cg-edge[data-branch="${index}:${row.values[index] ? 'T' : 'F'}"]`);
        if (edge) {
          edge.classList.add('on-path');
          setMarker(edge, true);
        }
      }
      const outcome = graph.querySelector(`.cg-outcome[data-outcome="${row.outcome}"]`);
      if (outcome) outcome.classList.add('on-path');
      const entry = graph.querySelector('.cg-entry');
      if (entry) {
        entry.classList.add('on-path');
        entry.setAttribute('marker-end', `url(#${graph.getAttribute('data-arrow')}-arrow-path)`);
      }
    }

    // Keep the traced source in view when the source pane scrolls on its own.
    if (scroll && sourcePane && sourcePane.scrollHeight > sourcePane.clientHeight) {
      const first =
        sourcePane.querySelector('.source:not([hidden]) .src-cond.is-decision') ||
        sourcePane.querySelector('.source:not([hidden]) .src-line.on-path');
      if (first) {
        const top = first.getBoundingClientRect().top - sourcePane.getBoundingClientRect().top + sourcePane.scrollTop;
        sourcePane.scrollTo({ top: Math.max(0, top - sourcePane.clientHeight / 3), behavior: 'smooth' });
      }
    }
  }

  // A file's source, read back from the rendered lines (the report embeds it once).
  function sourceOf(fileKey) {
    const lines = all(`.source[data-file="${fileKey}"] .src-line code`).map((code) => code.textContent);
    return lines.join('\n').trimEnd();
  }

  // Mirrors assembleTestPrompt() and sourceBlock() in testPrompt.ts. `key` is
  // 'all', a file key (`F0`) or a decision key (`F0-d3`).
  function promptFor(key) {
    const parts = data.prompt;
    if (!parts) return '';
    const sources = [];
    const blocks = [];
    for (const [fileKey, file] of Object.entries(parts.files)) {
      const chosen = Object.entries(file.decisions)
        .filter(([decision]) => key === 'all' || key === fileKey || key === decision)
        .map(([, block]) => block);
      if (chosen.length === 0) continue;
      sources.push(`${file.header}\n\n${file.fence}${file.language}\n${sourceOf(fileKey)}\n${file.fence}`);
      blocks.push(...chosen);
    }
    return [parts.intro, ...sources, parts.heading, ...blocks, parts.outro].join('\n\n');
  }

  function copyWithSelection(text) {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    scratch.remove();
    return copied;
  }

  async function copyPrompt(button) {
    const text = promptFor(button.getAttribute('data-prompt'));
    const label = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', label);
    let copied = false;
    try {
      // The Clipboard API can be unavailable for files opened from disk.
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = copyWithSelection(text);
    }
    button.textContent = copied ? 'Copied ✓' : 'Copy failed — use "Show prompt"';
    button.classList.toggle('is-copied', copied);
    setTimeout(() => {
      button.textContent = label;
      button.classList.remove('is-copied');
    }, 2000);
  }

  // Copy buttons only work with JavaScript, so they start hidden.
  for (const button of all('.copy-prompt')) button.hidden = false;

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const copyButton = target.closest('.copy-prompt');
    if (copyButton) {
      copyPrompt(copyButton);
      return;
    }
    const sourceButton = target.closest('[data-show-source]');
    if (sourceButton) {
      showSource(sourceButton.getAttribute('data-show-source'));
      return;
    }
    const tr = target.closest('tr[data-row][data-decision]');
    if (tr) {
      select(tr.getAttribute('data-decision'), Number(tr.getAttribute('data-row')), true);
      return;
    }
    // Clicking a condition in the source jumps to its (innermost) decision.
    const condition = target.closest('.src-cond[data-c]');
    if (condition) {
      const keys = condition.getAttribute('data-c').split(' ');
      const decisionId = keys[keys.length - 1].split(':')[0];
      const decision = data.decisions[decisionId];
      if (!decision) return;
      select(decisionId, decision.initialRow, false);
      const article = document.getElementById(`decision-${decisionId}`);
      if (article) article.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  document.addEventListener('keydown', (event) => {
    const tr = event.target instanceof Element ? event.target.closest('tr[data-row][data-decision]') : null;
    if (!tr) return;
    let next = null;
    if (event.key === 'ArrowDown') next = tr.nextElementSibling;
    else if (event.key === 'ArrowUp') next = tr.previousElementSibling;
    else if (event.key === 'Enter' || event.key === ' ') next = tr;
    if (!next) return;
    event.preventDefault();
    select(next.getAttribute('data-decision'), Number(next.getAttribute('data-row')), true);
    next.focus();
  });

  if (data.initial) select(data.initial.decision, data.initial.row, false);
})();
