/**
 * قراءة نموذج «بيانات التدوينة» والتحقق منه.
 *
 * القاعدة: **يُطبَّق ما غيّره المستخدم فقط.** النموذج يحمل القيم التي عُرضت له (`base`)،
 * فما لم يختلف عنها يُترك كما هو في المستودع — ولو غيّره جهاز آخر قبل لحظة. بهذا لا يضيّع
 * تعديلان متتاليان أحدهما الآخر، ولا تُمسّ قيمة قديمة غريبة لم يقصدها أحد (21 عنواناً في
 * الأرشيف بمسافة زائدة، و17 وسماً فيه فاصلة).
 *
 * دوال خالصة.
 */

import type { Classification } from './taxonomy.ts';
import { sameClassification } from './taxonomy.ts';

export interface MetaValues {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  labels: string[];
  classification: Classification;
}

/** الحقول التي تغيّرت فعلاً — غير المذكور لا يُمسّ */
export type MetaChange = Partial<MetaValues>;

export type MetaField = keyof MetaValues;
export type FieldErrors = Partial<Record<MetaField | 'form' | 'body', string>>;

const MAX_TITLE = 300;
const MAX_LABELS = 30;
const MAX_LABEL = 120;
const EARLIEST_DATE = '1970-01-01';
const DAY_MS = 24 * 60 * 60 * 1000;

/** سطر واحد نظيف: بلا محارف تحكّم ولا مسافات متكرّرة أو طرفية */
export function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** وسم في كل سطر (لا فواصل: بعض وسوم الأرشيف تحتوي فاصلة) */
export function parseLabels(text: string): string[] {
  const labels: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const label = cleanLine(line);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function isValidDate(value: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) return false;
  // تاريخ في المستقبل يرفع التدوينة فوق كل ما بعدها؛ يُسمح بيوم واحد لفرق التوقيت
  return value >= EARLIEST_DATE && time <= nowMs + DAY_MS;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** القيم كما أرسلها النموذج، بلا تحقق */
export function readMetaForm(form: FormData): MetaValues {
  const type = text(form, 'type');
  let classification: Classification = { type: 'none' };
  if (type === 'travel') {
    const primary = text(form, 'country');
    const others = form.getAll('countries').filter((value): value is string => typeof value === 'string');
    classification = { type: 'travel', countries: [...new Set([primary, ...others].filter(Boolean))] };
  } else if (type === 'other') {
    classification = { type: 'other', category: text(form, 'category') };
  }

  return {
    title: text(form, 'title'),
    date: text(form, 'date'),
    labels: parseLabels(text(form, 'labels')),
    classification,
  };
}

/** القيم التي عُرضت للمستخدم حين فتح الصفحة (حقل مخفي). null إن كانت معطوبة */
export function readBase(form: FormData): MetaValues | null {
  try {
    const base = JSON.parse(text(form, 'base')) as MetaValues;
    if (typeof base.title !== 'string' || typeof base.date !== 'string' || !Array.isArray(base.labels)) return null;
    if (!base.classification || typeof base.classification.type !== 'string') return null;
    return base;
  } catch {
    return null;
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** ما اختلف بين ما عُرض وما أُرسل */
export function diffMeta(base: MetaValues, submitted: MetaValues): MetaChange {
  const change: MetaChange = {};
  if (cleanLine(submitted.title) !== cleanLine(base.title)) change.title = cleanLine(submitted.title);
  if (submitted.date !== base.date) change.date = submitted.date;
  if (!sameList(submitted.labels, parseLabels(base.labels.join('\n')))) change.labels = submitted.labels;
  if (!sameClassification(submitted.classification, base.classification)) change.classification = submitted.classification;
  return change;
}

/** يتحقق من الحقول المتغيّرة وحدها (التصنيف يُفحص مقابل ملف التصنيف عند الحفظ) */
export function validateChange(change: MetaChange, nowMs: number = Date.now()): FieldErrors {
  const errors: FieldErrors = {};
  if (change.title !== undefined) {
    if (!change.title) errors.title = 'اكتب عنوان التدوينة.';
    else if (change.title.length > MAX_TITLE) errors.title = `العنوان أطول من ${MAX_TITLE} حرفاً.`;
  }
  if (change.date !== undefined && !isValidDate(change.date, nowMs)) {
    errors.date = 'اختر تاريخاً صحيحاً، وليس في المستقبل.';
  }
  if (change.labels !== undefined) {
    if (change.labels.length > MAX_LABELS) errors.labels = `أقصى عدد للوسوم ${MAX_LABELS}.`;
    else if (change.labels.some((label) => label.length > MAX_LABEL)) errors.labels = `وسم أطول من ${MAX_LABEL} حرفاً.`;
  }
  return errors;
}
