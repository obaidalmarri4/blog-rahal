/**
 * نسخة احتياطية محلية لتعديلات المحرّر غير المحفوظة (IndexedDB في هذا المتصفح فقط).
 *
 * لماذا محلية لا في المستودع: المستودع عام، وما يُكتب فيه يُنشر. النسخة هنا تحمي من
 * انقطاع الشبكة وإغلاق الصفحة بالخطأ، ولا تنتقل بين الأجهزة.
 *
 * كل الدوال تفشل بصمت (تصفّح خاص، مساحة ممتلئة): المحرّر يعمل بلا نسخة احتياطية.
 */

export interface Draft {
  slug: string;
  /** جسم التدوينة بالعناصر النائبة، كما يسلسله المحرّر */
  html: string;
  /** بصمة النص الذي بُني عليه التعديل */
  base: string;
  /** وقت الحفظ (ms) */
  at: number;
  /** «تدوينة جديدة» فقط: معرّفها وحقولها كما في النموذج */
  id?: string;
  meta?: Record<string, string | string[]>;
}

const DATABASE = 'rahal-studio';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'slug' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const database = await open();
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => database.close());
  } catch {
    return undefined;
  }
}

export const readDraft = (slug: string) => run<Draft | undefined>('readonly', (store) => store.get(slug));
export const writeDraft = (draft: Draft) => run('readwrite', (store) => store.put(draft));
export const clearDraft = (slug: string) => run('readwrite', (store) => store.delete(slug));
