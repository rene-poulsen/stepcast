import type { StepEvent } from '../../../shared/events';
import type { Lang } from './types';

type Phrase = (name: string, value?: string) => string;

const q = (s: string) => `'${s}'`;

const EN: Record<string, Phrase> = {
  click: (n) => `Click ${q(n)}`,
  'click:link': (n) => `Click ${q(n)} link`,
  'click:tab': (n) => `Open ${q(n)} tab`,
  'click:menuitem': (n) => `Choose ${q(n)}`,
  expand: (n) => `Expand ${q(n)}`,
  collapse: (n) => `Collapse ${q(n)}`,
  enter: (n) => (n ? `Enter ${q(n)}` : 'Enter text'),
  check: (n) => `Check ${q(n)}`,
  uncheck: (n) => `Uncheck ${q(n)}`,
  select: (n, v) => (v ? `Select ${q(v)} in ${q(n)}` : `Select ${q(n)}`),
  upload: (n) => `Upload file to ${q(n)}`,
  navigate: (n) => `Open ${q(n)}`,
  press: (n) => `Press ${n}`,
};

const DA: Record<string, Phrase> = {
  click: (n) => `Klik på ${q(n)}`,
  'click:link': (n) => `Klik på linket ${q(n)}`,
  'click:tab': (n) => `Åbn fanen ${q(n)}`,
  'click:menuitem': (n) => `Vælg ${q(n)}`,
  expand: (n) => `Fold ${q(n)} ud`,
  collapse: (n) => `Fold ${q(n)} sammen`,
  enter: (n) => (n ? `Udfyld ${q(n)}` : 'Skriv tekst'),
  check: (n) => `Sæt flueben i ${q(n)}`,
  uncheck: (n) => `Fjern flueben i ${q(n)}`,
  select: (n, v) => (v ? `Vælg ${q(v)} i ${q(n)}` : `Vælg ${q(n)}`),
  upload: (n) => `Upload fil til ${q(n)}`,
  navigate: (n) => `Åbn ${q(n)}`,
  press: (n) => `Tryk på ${n}`,
};

export function phrase(step: Pick<StepEvent, 'action' | 'role' | 'name' | 'value'>, lang: Lang): string {
  const table = lang === 'da' ? DA : EN;
  const fn = table[`${step.action}:${step.role}`] ?? table[step.action] ?? table.click;
  return fn(step.name, step.value);
}
