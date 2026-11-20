/**
 * قائمة التدوينات: بحث فوري في العناوين، فلتر «بلا تصنيف»، وعكس الترتيب.
 * القائمة كلها مرسومة من الخادم وتعمل بلا هذا السكربت — هو يخفي ويُظهر فقط.
 */

import { searchKey } from '../../lib/studio/text.ts';

const list = document.querySelector<HTMLElement>('[data-studio-list]');
const search = document.querySelector<HTMLInputElement>('[data-studio-search]');
const count = document.querySelector<HTMLElement>('[data-studio-count]');
const empty = document.querySelector<HTMLElement>('[data-studio-empty]');
const order = document.querySelector<HTMLButtonElement>('[data-studio-order]');
const filters = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];

if (list && search) {
  const rows = [...list.querySelectorAll<HTMLElement>('[data-post]')];
  let filter = 'all';

  const apply = () => {
    const query = searchKey(search.value);
    let shown = 0;
    for (const row of rows) {
      const visible = (!query || row.dataset.key!.includes(query)) && (filter === 'all' || row.dataset.cls === filter);
      row.hidden = !visible;
      if (visible) shown++;
    }
    if (count) count.textContent = shown === rows.length ? `${rows.length} تدوينة` : `${shown} من ${rows.length}`;
    if (empty) empty.hidden = shown > 0;
  };

  search.addEventListener('input', apply);

  for (const button of filters) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter!;
      for (const other of filters) other.setAttribute('aria-pressed', String(other === button));
      apply();
    });
  }

  order?.addEventListener('click', () => {
    const oldestFirst = list.classList.toggle('studio-posts--oldest');
    order.textContent = oldestFirst ? 'الأقدم أولاً' : 'الأحدث أولاً';
  });

  apply();
}
