/**
 * يتابع نشر آخر تعديل: يسأل ‎/api/studio/status‎ كل بضع ثوانٍ حتى ينتهي بناء Vercel.
 */

const POLL_MS = 8_000;
const GIVE_UP_MS = 6 * 60 * 1000;

const banner = document.querySelector<HTMLElement>('[data-deploy-sha]');
const label = banner?.querySelector<HTMLElement>('[data-deploy-text]');

if (banner && label) {
  const sha = banner.dataset.deploySha!;
  const startedAt = Date.now();

  const finish = (text: string, state: 'success' | 'failure' | 'late') => {
    label.textContent = text;
    banner.dataset.deployState = state;
  };

  const poll = async () => {
    try {
      const response = await fetch(`/api/studio/status?sha=${sha}`, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const { state } = (await response.json()) as { state: string };
        if (state === 'success') return finish('منشور الآن على الموقع ✓', 'success');
        if (state === 'failure') {
          return finish('محفوظ، لكن النشر تعثّر والموقع باقٍ على نسخته السابقة. أخبر عبيد.', 'failure');
        }
      }
    } catch {
      // انقطاع عابر: نحاول في الدورة التالية
    }
    if (Date.now() - startedAt > GIVE_UP_MS) {
      return finish('محفوظ. النشر تأخّر أكثر من المعتاد — سيظهر على الموقع حين ينتهي.', 'late');
    }
    setTimeout(poll, POLL_MS);
  };

  setTimeout(poll, POLL_MS);
}
