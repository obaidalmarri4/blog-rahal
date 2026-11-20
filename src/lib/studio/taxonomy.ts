/**
 * تصنيف التدوينات (src/data/taxonomy.json) كما تكتبه اللوحة.
 *
 * الملف يُحرَّر يدوياً اليوم ولا يُعاد توليده، فاللوحة تعدّل مفتاح التدوينة الواحدة وتترك
 * الباقي حرفاً بحرف: ترتيب المفاتيح محفوظ، والمفتاح الجديد يُضاف في الآخر (كما جرت العادة).
 *
 * دوال خالصة.
 */

export interface TaxonomyEntry {
  continent: string | null;
  countries: string[];
  type: string;
  category?: string;
}

export interface Taxonomy {
  posts: Record<string, TaxonomyEntry>;
  continents: Record<string, { emoji: string; slug: string }>;
  countries: Record<string, { slug: string; continent: string }>;
}

/** فئات التدوينات غير الرحلات — نفس القيم المستعملة في الملف اليوم */
export const CATEGORIES = ['عام', 'تراث محلي', 'تاريخ وثقافة', 'نصائح سفر', 'طعام ومشروبات'];

export const MAX_COUNTRIES = 8;

export type Classification =
  | { type: 'none' }
  | { type: 'travel'; countries: string[] }
  | { type: 'other'; category: string };

export function parseTaxonomy(raw: string): Taxonomy {
  const taxonomy = JSON.parse(raw) as Taxonomy;
  if (!taxonomy || typeof taxonomy.posts !== 'object' || typeof taxonomy.countries !== 'object') {
    throw new Error('taxonomy.json: unexpected shape');
  }
  return taxonomy;
}

/** نفس تنسيق الملف الحالي (مسافتان)، مع إبقاء السطر الأخير كما كان */
export function serializeTaxonomy(taxonomy: Taxonomy, previousRaw: string): string {
  return JSON.stringify(taxonomy, null, 2) + (previousRaw.endsWith('\n') ? '\n' : '');
}

/** تصنيف تدوينة كما هو في الملف، بالشكل الذي تعرضه اللوحة */
export function classificationOf(taxonomy: Taxonomy, slug: string): Classification {
  const entry = taxonomy.posts[slug];
  if (!entry) return { type: 'none' };
  if (entry.type === 'travel') return { type: 'travel', countries: [...(entry.countries ?? [])] };
  return { type: 'other', category: entry.category ?? 'عام' };
}

/** الدولة الأولى هي الأساسية وقارّتها قارّة التدوينة؛ والباقي بلا ترتيب */
export function sameClassification(a: Classification, b: Classification): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'travel' && b.type === 'travel') {
    if (a.countries.length !== b.countries.length || a.countries[0] !== b.countries[0]) return false;
    return a.countries.every((country) => b.countries.includes(country));
  }
  if (a.type === 'other' && b.type === 'other') return a.category === b.category;
  return true;
}

/** يعيد سبب الرفض، أو null إن كان التصنيف صالحاً لهذا الملف */
export function classificationProblem(taxonomy: Taxonomy, value: Classification): string | null {
  if (value.type === 'travel') {
    if (value.countries.length === 0) return 'اختر الدولة.';
    if (value.countries.length > MAX_COUNTRIES) return `أقصى عدد للدول ${MAX_COUNTRIES}.`;
    if (new Set(value.countries).size !== value.countries.length) return 'دولة مكرّرة.';
    if (value.countries.some((country) => !Object.hasOwn(taxonomy.countries, country))) return 'دولة غير معروفة.';
  }
  if (value.type === 'other' && !CATEGORIES.includes(value.category)) return 'فئة غير معروفة.';
  return null;
}

/** يطبّق التصنيف على مفتاح التدوينة. يعيد true إن تغيّر الملف */
export function applyClassification(taxonomy: Taxonomy, slug: string, value: Classification): boolean {
  if (sameClassification(classificationOf(taxonomy, slug), value)) return false;

  if (value.type === 'none') {
    delete taxonomy.posts[slug];
  } else if (value.type === 'travel') {
    taxonomy.posts[slug] = {
      continent: taxonomy.countries[value.countries[0]].continent,
      countries: [...value.countries],
      type: 'travel',
    };
  } else {
    taxonomy.posts[slug] = { continent: null, countries: [], type: 'other', category: value.category };
  }
  return true;
}

/** الدول مجموعةً بحسب القارّة ومرتّبة أبجدياً — لقوائم الاختيار */
export function countriesByContinent(taxonomy: Taxonomy): { continent: string; countries: string[] }[] {
  const collator = new Intl.Collator('ar');
  return Object.keys(taxonomy.continents)
    .map((continent) => ({
      continent,
      countries: Object.keys(taxonomy.countries)
        .filter((country) => taxonomy.countries[country].continent === continent)
        .sort(collator.compare),
    }))
    .filter((group) => group.countries.length > 0);
}
