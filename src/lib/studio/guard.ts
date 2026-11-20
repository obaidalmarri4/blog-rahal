/**
 * القفل الثاني على صفحات اللوحة ونقاطها. الحارس (src/middleware.ts) هو القفل الأول؛ هذا
 * يضمن أن أي صفحة وصلها طلب لم يمرّ بالحارس — خطأ في مطابقة مسار، أو تغيير لاحق في
 * الحارس — تردّ 404 بدل أن تُفتح.
 *
 * الاستعمال في أول كل صفحة ونقطة تحت ‎/studio‎ و ‎/api/studio‎:
 *
 *   const denied = requireStudio(Astro.locals);   // أو (context.locals, 'entering')
 *   if (denied) return denied;
 */
export function requireStudio(
  locals: App.Locals,
  state: NonNullable<App.Locals['studio']> = 'paired'
): Response | null {
  if (locals.studio === state) return null;
  // جسم غير فارغ عمداً: ردّ 404 بلا جسم يجعل Astro يجلب ‎/404.html‎ من الشبكة
  return new Response('Not found', { status: 404 });
}
