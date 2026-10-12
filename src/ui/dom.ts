type Child = Node | string | null | undefined | false;

type Listeners = { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };

export interface Props {
  readonly class?: string;
  readonly title?: string;
  readonly attrs?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly on?: Listeners;
}

/** Minimal element factory so views can be written declaratively without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.title) element.title = props.title;
  setAttributes(element, props.attrs);
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    element.addEventListener(type, listener as EventListener);
  }
  append(element, children);
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | number | boolean | undefined>> = {},
  children: readonly Child[] = [],
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  setAttributes(element, attrs);
  append(element, children);
  return element;
}

function setAttributes(element: Element, attrs: Props['attrs']): void {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
}

function append(element: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
}
