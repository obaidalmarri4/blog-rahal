/**
 * خيارات شريط أدوات المحرّر. ملف بلا أي اعتماد: تقرؤه صفحة المحرّر في الخادم لترسم الشريط،
 * وسكربت المحرّر في المتصفح ليطبّق الاختيار.
 */

/** أحجام الخط — نسبية (em) لتتبع قياس الصفحة على الجوال والكمبيوتر. `value: null` = حجم النص العادي */
export const FONT_SIZES = [
  { id: 'small', label: 'صغير', value: '0.85em' },
  { id: 'normal', label: 'عادي', value: null },
  { id: 'large', label: 'كبير', value: '1.25em' },
  { id: 'huge', label: 'كبير جداً', value: '1.6em' },
];

/** ألوان النص — من هوية الموقع. `value: null` = لون النص العادي (حبر) */
export const TEXT_COLORS = [
  { id: 'ink', label: 'حبر', value: null, swatch: '#2a2218' },
  { id: 'clay', label: 'طيني', value: '#c8612e', swatch: '#c8612e' },
  { id: 'gold', label: 'ذهبي', value: '#c9a04a', swatch: '#c9a04a' },
  { id: 'olive', label: 'زيتوني', value: '#6b7d5a', swatch: '#6b7d5a' },
];
