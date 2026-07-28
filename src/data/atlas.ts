export interface UnvisitedCountry {
  ar: string;
  en: string;
  region: string;
}

export const UNVISITED_ISO: Record<string, UnvisitedCountry> = {
  LBY: { ar: 'ليبيا', en: 'Libya', region: 'أفريقيا · شمال' },
  TCD: { ar: 'تشاد', en: 'Chad', region: 'أفريقيا · وسط' },
  NER: { ar: 'النيجر', en: 'Niger', region: 'أفريقيا · غرب' },
  CUB: { ar: 'كوبا', en: 'Cuba', region: 'الكاريبي' },
  PRK: { ar: 'كوريا الشمالية', en: 'North Korea', region: 'آسيا · شرق' },
  SLB: { ar: 'جزر سليمان', en: 'Solomon Islands', region: 'أوقيانوسيا' },
};

export const UNVISITED_TERRITORIES = [
  { ar: 'بورا بورا', en: 'Bora Bora', context: 'بولينيزيا الفرنسية' },
  { ar: 'جزر العذراء', en: 'Virgin Islands', context: 'الكاريبي' },
];

export const AR_NAMES: Record<string, string> = {
  SAU: 'المملكة العربية السعودية', ARE: 'الإمارات', KWT: 'الكويت',
  QAT: 'قطر', BHR: 'البحرين', OMN: 'عُمان', YEM: 'اليمن',
  EGY: 'مصر', JOR: 'الأردن', LBN: 'لبنان', SYR: 'سوريا',
  IRQ: 'العراق', PSE: 'فلسطين', TUR: 'تركيا',
  IRN: 'إيران', AFG: 'أفغانستان', PAK: 'باكستان', IND: 'الهند',
  CHN: 'الصين', JPN: 'اليابان', KOR: 'كوريا الجنوبية', MNG: 'منغوليا',
  THA: 'تايلاند', VNM: 'فيتنام', LAO: 'لاوس', KHM: 'كمبوديا',
  MMR: 'ميانمار', MYS: 'ماليزيا', SGP: 'سنغافورة', IDN: 'إندونيسيا',
  PHL: 'الفلبين', BRN: 'بروناي', LKA: 'سريلانكا', NPL: 'نيبال',
  BTN: 'بوتان', BGD: 'بنغلاديش', MDV: 'المالديف', KAZ: 'كازاخستان',
  UZB: 'أوزبكستان', TKM: 'تركمانستان', KGZ: 'قيرغيزستان', TJK: 'طاجيكستان',
  AZE: 'أذربيجان', ARM: 'أرمينيا', GEO: 'جورجيا', RUS: 'روسيا',
  USA: 'الولايات المتحدة', CAN: 'كندا', MEX: 'المكسيك', BRA: 'البرازيل',
  ARG: 'الأرجنتين', CHL: 'تشيلي', PER: 'بيرو', COL: 'كولومبيا',
  VEN: 'فنزويلا', ECU: 'الإكوادور', BOL: 'بوليفيا', URY: 'الأوروغواي',
  PRY: 'باراغواي', GUY: 'غيانا', SUR: 'سورينام',
  GBR: 'المملكة المتحدة', FRA: 'فرنسا', DEU: 'ألمانيا', ITA: 'إيطاليا',
  ESP: 'إسبانيا', PRT: 'البرتغال', NLD: 'هولندا', BEL: 'بلجيكا',
  CHE: 'سويسرا', AUT: 'النمسا', SWE: 'السويد', NOR: 'النرويج',
  DNK: 'الدنمارك', FIN: 'فنلندا', POL: 'بولندا', CZE: 'التشيك',
  GRC: 'اليونان', HUN: 'المجر', ROU: 'رومانيا', BGR: 'بلغاريا',
  HRV: 'كرواتيا', SRB: 'صربيا', UKR: 'أوكرانيا', IRL: 'أيرلندا',
  ISL: 'آيسلندا', ALB: 'ألبانيا', MAR: 'المغرب', DZA: 'الجزائر',
  TUN: 'تونس', SDN: 'السودان', SSD: 'جنوب السودان', ETH: 'إثيوبيا',
  KEN: 'كينيا', UGA: 'أوغندا', TZA: 'تنزانيا', RWA: 'رواندا',
  ZAF: 'جنوب أفريقيا', NAM: 'ناميبيا', BWA: 'بوتسوانا', ZWE: 'زيمبابوي',
  MOZ: 'موزمبيق', MDG: 'مدغشقر', GHA: 'غانا', GIN: 'غينيا', NGA: 'نيجيريا',
  CIV: 'ساحل العاج', SEN: 'السنغال', AUS: 'أستراليا', NZL: 'نيوزيلندا',
  FJI: 'فيجي', PNG: 'بابوا غينيا الجديدة',
  LBY: 'ليبيا', TCD: 'تشاد', NER: 'النيجر', CUB: 'كوبا',
  PRK: 'كوريا الشمالية', SLB: 'جزر سليمان',
};

/**
 * ISO_A3 → اسم الدولة كما هو حرفياً في مفاتيح taxonomy.json "countries".
 * تهجئة taxonomy هي المرجع هنا حتى لو خالفت AR_NAMES (مثل: السعودية، بريطانيا، تايلند).
 * ملاحظة: BHR/MDV/MLT صغيرة جداً ولا تظهر كمضلعات في countries-110m فلن تكون قابلة للنقر.
 */
export const ISO_TO_TAXONOMY: Record<string, string> = {
  // الشرق الأوسط
  SAU: 'السعودية', KWT: 'الكويت', QAT: 'قطر', BHR: 'البحرين',
  OMN: 'عمان', YEM: 'اليمن', JOR: 'الأردن', IRQ: 'العراق', PSE: 'فلسطين',
  // آسيا
  TUR: 'تركيا', PAK: 'باكستان', IND: 'الهند', CHN: 'الصين', JPN: 'اليابان',
  KOR: 'كوريا', MNG: 'منغوليا', THA: 'تايلند', MYS: 'ماليزيا', IDN: 'إندونيسيا',
  PHL: 'الفلبين', LKA: 'سريلانكا', NPL: 'نيبال', BTN: 'بوتان', MDV: 'المالديف',
  UZB: 'أوزبكستان', KGZ: 'قيرغيزستان', GEO: 'جورجيا',
  // أوروبا
  GBR: 'بريطانيا', DEU: 'ألمانيا', ITA: 'إيطاليا', ESP: 'إسبانيا', PRT: 'البرتغال',
  AUT: 'النمسا', NOR: 'النرويج', POL: 'بولندا', CZE: 'التشيك', GRC: 'اليونان',
  HUN: 'المجر', BGR: 'بلغاريا', HRV: 'كرواتيا', UKR: 'أوكرانيا', ALB: 'ألبانيا',
  RUS: 'روسيا', SVN: 'سلوفينيا', BIH: 'البوسنة', MLT: 'مالطا', CHE: 'سويسرا',
  // أفريقيا
  MAR: 'المغرب', DZA: 'الجزائر', TUN: 'تونس', EGY: 'مصر', KEN: 'كينيا',
  ZAF: 'جنوب أفريقيا', ZWE: 'زيمبابوي', MLI: 'مالي', BDI: 'بوروندي',
  MDG: 'مدغشقر', SEN: 'السنغال', GHA: 'غانا', GIN: 'غينيا',
  // الأمريكتان
  USA: 'أمريكا', MEX: 'المكسيك', PAN: 'بنما', BRA: 'البرازيل', ARG: 'الأرجنتين',
  CHL: 'تشيلي', PER: 'البيرو', COL: 'كولومبيا', ECU: 'الإكوادور', BOL: 'بوليفيا',
  // أوقيانوسيا
  NZL: 'نيوزلندا', AUS: 'أستراليا',
};

export interface ContinentStat {
  ar: string;
  en: string;
  glyph: string;
  count: number;
  posts: number;
}

export const CONTINENT_STATS: ContinentStat[] = [
  { ar: 'آسيا', en: 'Asia', glyph: '◐', count: 28, posts: 76 },
  { ar: 'الشرق الأوسط', en: 'Middle East', glyph: '✦', count: 14, posts: 74 },
  { ar: 'أوروبا', en: 'Europe', glyph: '◑', count: 42, posts: 34 },
  { ar: 'أفريقيا', en: 'Africa', glyph: '◓', count: 48, posts: 38 },
  { ar: 'أمريكا الجنوبية', en: 'S. America', glyph: '◒', count: 13, posts: 29 },
  { ar: 'أمريكا الشمالية', en: 'N. America', glyph: '◉', count: 23, posts: 12 },
  { ar: 'أوقيانوسيا', en: 'Oceania', glyph: '○', count: 12, posts: 0 },
];

export const MIDNIGHT_THEME = {
  bg: '#0a0e1a',
  globeBg: '#0a0e1a',
  ocean: '#101729',
  visited: '#c9a96e',
  visitedHover: '#f0d090',
  unvisited: '#3a2228',
  stroke: 'rgba(10, 14, 26, 0.85)',
  atmosphere: '#d4b87a',
  text: '#ebe4d2',
  textMuted: '#8a8475',
  accent: '#d4b87a',
  border: 'rgba(212, 184, 122, 0.18)',
  panel: 'rgba(15, 20, 36, 0.7)',
} as const;

export const NUM_TO_A3: Record<string, string> = {
  '004':'AFG','008':'ALB','012':'DZA','020':'AND','024':'AGO','028':'ATG','031':'AZE','032':'ARG','036':'AUS','040':'AUT',
  '044':'BHS','048':'BHR','050':'BGD','051':'ARM','052':'BRB','056':'BEL','060':'BMU','064':'BTN','068':'BOL','070':'BIH',
  '072':'BWA','076':'BRA','084':'BLZ','090':'SLB','096':'BRN','100':'BGR','104':'MMR','108':'BDI','112':'BLR','116':'KHM',
  '120':'CMR','124':'CAN','132':'CPV','140':'CAF','144':'LKA','148':'TCD','152':'CHL','156':'CHN','158':'TWN','170':'COL',
  '174':'COM','178':'COG','180':'COD','188':'CRI','191':'HRV','192':'CUB','196':'CYP','203':'CZE','204':'BEN','208':'DNK',
  '212':'DMA','214':'DOM','218':'ECU','222':'SLV','226':'GNQ','231':'ETH','232':'ERI','233':'EST','242':'FJI','246':'FIN',
  '250':'FRA','254':'GUF','258':'PYF','260':'ATF','262':'DJI','266':'GAB','268':'GEO','270':'GMB','275':'PSE','276':'DEU',
  '288':'GHA','296':'KIR','300':'GRC','304':'GRL','308':'GRD','316':'GUM','320':'GTM','324':'GIN','328':'GUY','332':'HTI',
  '340':'HND','344':'HKG','348':'HUN','352':'ISL','356':'IND','360':'IDN','364':'IRN','368':'IRQ','372':'IRL','376':'ISR',
  '380':'ITA','384':'CIV','388':'JAM','392':'JPN','398':'KAZ','400':'JOR','404':'KEN','408':'PRK','410':'KOR','414':'KWT',
  '417':'KGZ','418':'LAO','422':'LBN','426':'LSO','428':'LVA','430':'LBR','434':'LBY','438':'LIE','440':'LTU','442':'LUX',
  '450':'MDG','454':'MWI','458':'MYS','462':'MDV','466':'MLI','470':'MLT','478':'MRT','480':'MUS','484':'MEX','492':'MCO',
  '496':'MNG','498':'MDA','499':'MNE','504':'MAR','508':'MOZ','512':'OMN','516':'NAM','520':'NRU','524':'NPL','528':'NLD',
  '540':'NCL','548':'VUT','554':'NZL','558':'NIC','562':'NER','566':'NGA','578':'NOR','583':'FSM','584':'MHL','585':'PLW',
  '586':'PAK','591':'PAN','598':'PNG','600':'PRY','604':'PER','608':'PHL','616':'POL','620':'PRT','624':'GNB','626':'TLS',
  '630':'PRI','634':'QAT','642':'ROU','643':'RUS','646':'RWA','662':'LCA','670':'VCT','678':'STP','682':'SAU','686':'SEN',
  '688':'SRB','690':'SYC','694':'SLE','702':'SGP','703':'SVK','704':'VNM','705':'SVN','706':'SOM','710':'ZAF','716':'ZWE',
  '724':'ESP','728':'SSD','729':'SDN','740':'SUR','748':'SWZ','752':'SWE','756':'CHE','760':'SYR','762':'TJK','764':'THA',
  '768':'TGO','776':'TON','780':'TTO','784':'ARE','788':'TUN','792':'TUR','795':'TKM','798':'TUV','800':'UGA','804':'UKR',
  '807':'MKD','818':'EGY','826':'GBR','834':'TZA','840':'USA','854':'BFA','858':'URY','860':'UZB','862':'VEN','882':'WSM',
  '887':'YEM','894':'ZMB','-99':'XKX',
};
