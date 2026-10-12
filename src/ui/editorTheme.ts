import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** Syntax colours come from CSS variables so they follow light/dark mode. */
export const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.modifier], color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.definition(tags.variableName)), tags.definition(tags.propertyName)], color: 'var(--syn-def)' },
  { tag: [tags.typeName, tags.className], color: 'var(--syn-type)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
]);

/**
 * Cursor and selection colours from CSS variables. CodeMirror's defaults are a
 * black cursor and a light-grey selection, which vanish on the dark theme.
 */
export const editorChrome = EditorView.theme({
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-content ::selection': { background: 'color-mix(in srgb, var(--accent) 28%, transparent)' },
});
