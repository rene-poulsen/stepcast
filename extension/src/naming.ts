// Works out what the user interacted with: the element, its role and a human name.
import { computeAccessibleName } from 'dom-accessibility-api';
import type { Action, Role } from '../../shared/events';

const MAX_NAME = 60;

const INTERACTIVE = [
  'a[href]',
  'button',
  'summary',
  'label',
  'select',
  'textarea',
  'input',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="treeitem"]',
  '[onclick]',
].join(',');

/** Native form controls report through `change`/`focusin` instead of `click`. */
const NATIVE_FORM_ROLES: Role[] = ['checkbox', 'radio', 'select', 'textbox', 'file'];

/** Finds the element the user meant to click, starting from the event target. */
export function findClickTarget(start: Element): Element | null {
  const hit = start.closest(INTERACTIVE);
  if (hit) return hit;

  // Divs with click handlers usually show a pointer cursor. The cursor is inherited,
  // so take the outermost ancestor that still has it.
  let found: Element | null = null;
  let cur: Element | null = start;
  for (let depth = 0; cur && cur !== cur.ownerDocument.body && depth < 8; depth++) {
    if (getComputedStyle(cur).cursor === 'pointer') found = cur;
    else if (found) break;
    cur = cur.parentElement;
  }
  return found;
}

function labelledControl(el: Element): Element | null {
  if (el instanceof HTMLLabelElement) return el.control;
  return null;
}

export function roleOf(el: Element): Role {
  const control = labelledControl(el);
  if (control) return roleOf(control);

  const role = el.getAttribute('role');
  const expandable = el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup');
  switch (role) {
    case 'tab':
      return 'tab';
    case 'link':
      return expandable ? 'accordion' : 'link';
    case 'menuitem':
    case 'menuitemcheckbox':
    case 'menuitemradio':
      return 'menuitem';
    case 'switch':
      return 'switch';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'option':
    case 'treeitem':
      return 'option';
    case 'button':
      return expandable ? 'accordion' : 'button';
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'summary') return 'accordion';
  if (tag === 'a') return expandable ? 'accordion' : 'link';
  if (tag === 'button') return expandable ? 'accordion' : 'button';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file';
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (['range', 'color', 'hidden'].includes(type)) return 'generic';
    return 'textbox';
  }
  if ((el as HTMLElement).isContentEditable) return 'textbox';
  return 'generic';
}

export function isNativeFormControl(el: Element): boolean {
  const target = labelledControl(el) ?? el;
  const tag = target.tagName.toLowerCase();
  const native =
    tag === 'input' || tag === 'select' || tag === 'textarea' || (target as HTMLElement).isContentEditable === true;
  return native && NATIVE_FORM_ROLES.includes(roleOf(target));
}

export function cleanName(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_NAME ? text.slice(0, MAX_NAME - 1).trimEnd() + '…' : text;
}

/** The name a person would use for the element: its label, aria-label, text, etc. */
export function nameOf(el: Element): string {
  const target = labelledControl(el) ?? el;
  let name = '';
  try {
    name = cleanName(computeAccessibleName(target));
  } catch {
    // Some pages produce DOM states the library can't handle; the fallbacks below cover them.
  }
  if (name) return name;

  for (const attr of ['placeholder', 'aria-placeholder', 'title', 'alt']) {
    const value = cleanName(target.getAttribute(attr));
    if (value) return value;
  }
  const text = cleanName((target as HTMLElement).innerText ?? target.textContent);
  if (text) return text;
  for (const attr of ['name', 'id']) {
    const value = cleanName(target.getAttribute(attr));
    if (value) return humanize(value);
  }
  return '';
}

/** "first_name" / "firstName" → "First name". */
function humanize(id: string): string {
  const words = id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a click on this element does, read before the page handles the click. */
export function clickAction(el: Element, role: Role): Action {
  if (role === 'accordion') {
    const open =
      el.tagName.toLowerCase() === 'summary'
        ? (el.parentElement as HTMLDetailsElement | null)?.open === true
        : el.getAttribute('aria-expanded') === 'true';
    return open ? 'collapse' : 'expand';
  }
  if (role === 'checkbox' || role === 'switch') {
    return el.getAttribute('aria-checked') === 'true' ? 'uncheck' : 'check';
  }
  if (role === 'radio' || role === 'option') return 'select';
  return 'click';
}

/** Action and value for a `change` event on a native form control. */
export function changeAction(el: Element): { action: Action; role: Role; value?: string } | null {
  const role = roleOf(el);
  if (role === 'checkbox') return { action: (el as HTMLInputElement).checked ? 'check' : 'uncheck', role };
  if (role === 'radio') return (el as HTMLInputElement).checked ? { action: 'select', role } : null;
  if (role === 'file') return { action: 'upload', role };
  if (role === 'select') {
    const select = el as HTMLSelectElement;
    const value = cleanName(Array.from(select.selectedOptions, (o) => o.text).join(', '));
    return { action: 'select', role, value };
  }
  return null;
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Delete: 'Delete',
  Backspace: 'Backspace',
};

/**
 * The shortcut worth showing for a key press ("Enter", "Ctrl+S", "Cmd+Shift+P"), or null for
 * ordinary typing, which is already covered by "Enter '…'".
 */
export function shortcutLabel(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac: boolean): string | null {
  const { key } = e;
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return null;
  const command = e.ctrlKey || e.metaKey || (e.altKey && !mac);
  const special = key === 'Enter' || key === 'Escape' || /^F\d{1,2}$/.test(key);
  if (!command && !special) return null;
  // AltGr on Windows reports Ctrl+Alt; it types characters like @ and {.
  if (e.ctrlKey && e.altKey && !mac && key.length === 1 && !/[a-z0-9]/i.test(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push(mac ? 'Control' : 'Ctrl');
  if (e.metaKey) parts.push(mac ? 'Cmd' : 'Win');
  if (e.altKey) parts.push(mac ? 'Option' : 'Alt');
  if (e.shiftKey && (command || special)) parts.push('Shift');
  parts.push(KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join('+');
}

/** Text fields that should produce "Enter '…'" when they receive focus. */
export function isTextEntry(el: Element): boolean {
  return roleOf(el) === 'textbox' && !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled;
}
