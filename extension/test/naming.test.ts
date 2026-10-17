// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { changeAction, clickAction, findClickTarget, isNativeFormControl, nameOf, roleOf, shortcutLabel } from '../src/naming';

const html = readFileSync(resolve(process.cwd(), 'test/playground.html'), 'utf8');

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
});

const $ = (sel: string) => document.querySelector(sel)!;

describe('click targets', () => {
  it('resolves a click inside a link to the link', () => {
    const svg = $('nav a[aria-label] circle');
    const target = findClickTarget(svg)!;
    expect(target.tagName).toBe('A');
    expect(nameOf(target)).toBe('Contact page');
    expect(roleOf(target)).toBe('link');
  });

  it('finds onclick cards from inner text', () => {
    const target = findClickTarget($('#plan-pro span'))!;
    expect(target.id).toBe('plan-pro');
    expect(nameOf(target)).toBe('Pro plan – 99 kr/month');
  });
});

describe('names and roles', () => {
  it.each([
    ['nav a[href="#products"]', 'link', 'Products'],
    ['nav a[href="#about"]', 'link', 'About us'],
    ['#save', 'button', 'Save changes'],
    ['button[aria-label="Close dialog"]', 'button', 'Close dialog'],
    ['input[type=submit]', 'button', 'Send order'],
    ['#tab-pricing', 'tab', 'Pricing'],
    ['#shipping', 'accordion', 'Shipping and returns'],
    ['#faq-toggle', 'accordion', 'How do I cancel?'],
    ['#username', 'textbox', 'Username'],
    ['#password', 'textbox', 'Password'],
    ['#email', 'textbox', 'Email'],
    ['#search', 'textbox', 'Search products'],
    ['#first_name', 'textbox', 'First name'],
    ['#terms', 'checkbox', 'I accept the terms & conditions'],
    ['#country', 'select', 'Country'],
    ['#pickup', 'radio', 'Pick up in store'],
    ['#newsletter', 'checkbox', 'Send me the newsletter'],
  ])('%s → %s "%s"', (sel, role, name) => {
    expect(roleOf($(sel))).toBe(role);
    expect(nameOf($(sel))).toBe(name);
  });
});

describe('actions', () => {
  it('expands, then collapses an accordion', () => {
    const faq = $('#faq-toggle');
    expect(clickAction(faq, 'accordion')).toBe('expand');
    faq.setAttribute('aria-expanded', 'true');
    expect(clickAction(faq, 'accordion')).toBe('collapse');

    const summary = $('#shipping');
    expect(clickAction(summary, 'accordion')).toBe('expand');
    (summary.parentElement as HTMLDetailsElement).open = true;
    expect(clickAction(summary, 'accordion')).toBe('collapse');
  });

  it('reads custom checkbox state before the click', () => {
    expect(clickAction($('#newsletter'), 'checkbox')).toBe('check');
  });

  it('describes native changes', () => {
    const terms = $('#terms') as HTMLInputElement;
    terms.checked = true;
    expect(changeAction(terms)).toEqual({ action: 'check', role: 'checkbox' });
    terms.checked = false;
    expect(changeAction(terms)).toEqual({ action: 'uncheck', role: 'checkbox' });

    const country = $('#country') as HTMLSelectElement;
    country.selectedIndex = 1;
    expect(changeAction(country)).toEqual({ action: 'select', role: 'select', value: 'Sweden' });
  });

  it('leaves native form controls (and their labels) to change/focus events', () => {
    expect(isNativeFormControl($('#terms'))).toBe(true);
    expect(isNativeFormControl($('#terms').closest('label')!)).toBe(true);
    expect(isNativeFormControl($('#username'))).toBe(true);
    expect(isNativeFormControl($('#save'))).toBe(false);
    expect(isNativeFormControl($('#newsletter'))).toBe(false);
  });
});

describe('keyboard shortcuts', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it('labels Enter, Esc and shortcuts', () => {
    expect(shortcutLabel(key('Enter'), false)).toBe('Enter');
    expect(shortcutLabel(key('Escape'), false)).toBe('Esc');
    expect(shortcutLabel(key('s', { ctrlKey: true }), false)).toBe('Ctrl+S');
    expect(shortcutLabel(key('P', { metaKey: true, shiftKey: true }), true)).toBe('Cmd+Shift+P');
    expect(shortcutLabel(key('F5'), false)).toBe('F5');
  });

  it('ignores ordinary typing, modifiers alone and AltGr characters', () => {
    expect(shortcutLabel(key('a'), false)).toBeNull();
    expect(shortcutLabel(key('A', { shiftKey: true }), false)).toBeNull();
    expect(shortcutLabel(key('Control', { ctrlKey: true }), false)).toBeNull();
    expect(shortcutLabel(key('@', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutLabel(key('å', { altKey: true }), true)).toBeNull();
  });
});
