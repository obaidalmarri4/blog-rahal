import Globe from 'globe.gl';
import * as topojson from 'topojson-client';
import { UNVISITED_ISO, AR_NAMES, NUM_TO_A3, MIDNIGHT_THEME } from '../data/atlas';

export type GeoFeature = {
  id?: string | number;
  geometry: { type: string; coordinates: any };
  properties: {
    ISO_A3?: string;
    ADMIN?: string;
    NAME?: string;
    name?: string;
  };
};

export type CountryPayload = {
  ar: string;
  url: string;
  posts: { t: string; s: string; d: string; i: string }[];
};

const theme = MIDNIGHT_THEME;

function flatten(c: any): [number, number][] {
  if (!Array.isArray(c)) return [];
  if (typeof c[0] === 'number') return [c as [number, number]];
  return c.flatMap(flatten);
}

let featuresPromise: Promise<GeoFeature[]> | null = null;

export function loadCountryFeatures(): Promise<GeoFeature[]> {
  if (!featuresPromise) {
    featuresPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then((r) => r.json())
      .then((topo: any) => {
        const collection = (topojson as any).feature(topo, topo.objects.countries) as any;
        const features = collection.features as GeoFeature[];
        features.forEach((f) => {
          let alpha3 = NUM_TO_A3[String(f.id)] || '';
          f.properties = f.properties || {};
          // الخريطة تعرض فلسطين موحّدة: مضلّع ISR في topojson يُصنَّف فلسطين
          if (alpha3 === 'ISR') {
            alpha3 = 'PSE';
            f.properties.name = 'Palestine';
          }
          f.properties.ISO_A3 = alpha3;
          f.properties.ADMIN = f.properties.name || f.properties.ADMIN;
          f.properties.NAME = f.properties.name;
        });
        return features;
      });
  }
  return featuresPromise;
}

export function initAtlas(
  containerEl: HTMLElement,
  countryData: Record<string, CountryPayload> = {}
) {
  const hoverCard = document.getElementById('rh-hover-card');
  const hoverStatus = document.getElementById('rh-hover-status');
  const hoverAr = document.getElementById('rh-hover-ar');
  const hoverEn = document.getElementById('rh-hover-en');
  const hoverIso = document.getElementById('rh-hover-iso');

  const panel = document.getElementById('rh-country-panel');
  const panelStatus = document.getElementById('rh-popup-status');
  const panelAr = document.getElementById('rh-popup-ar');
  const panelCount = document.getElementById('rh-popup-count');
  const panelClose = document.getElementById('rh-popup-close');
  const panelList = document.getElementById('rh-popup-list');
  const panelMore = document.getElementById('rh-popup-more') as HTMLAnchorElement | null;
  const panelEmpty = document.getElementById('rh-popup-empty');

  let hovered: GeoFeature | null = null;
  let focusIso: string | null = null;
  let selectedIso: string | null = null;
  let features: GeoFeature[] = [];

  const world: any = (Globe as any)()(containerEl);
  world
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor(theme.atmosphere)
    .atmosphereAltitude(0.18)
    .showGraticules(false)
    .polygonsTransitionDuration(300)
    .polygonLabel(() => '');

  // size to container
  const fitSize = () => {
    const r = containerEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) world.width(r.width).height(r.height);
  };
  fitSize();
  const ro = new ResizeObserver(fitSize);
  ro.observe(containerEl);
  window.addEventListener('resize', fitSize);

  // globe material → ocean color
  const m = world.globeMaterial();
  m.color.setStyle(theme.ocean);
  if (m.emissive) m.emissive.setStyle(theme.ocean);
  m.emissiveIntensity = 0.15;
  m.shininess = 0.4;

  // controls
  const ctrls = world.controls();
  ctrls.autoRotate = true;
  ctrls.autoRotateSpeed = 0.35;
  ctrls.enableZoom = true;
  ctrls.minDistance = 180;
  ctrls.maxDistance = 600;

  world.pointOfView({ lat: 24, lng: 45, altitude: 2.2 }, 0);

  const applyPolygons = () => {
    world
      .polygonCapColor((d: GeoFeature) => {
        const iso = d.properties.ISO_A3 || '';
        if (UNVISITED_ISO[iso]) return theme.unvisited;
        if (selectedIso && iso === selectedIso) return theme.visitedHover;
        if (focusIso && iso === focusIso) return theme.visitedHover;
        if (hovered && d === hovered) return theme.visitedHover;
        return theme.visited;
      })
      .polygonSideColor((d: GeoFeature) => {
        const iso = d.properties.ISO_A3 || '';
        if (UNVISITED_ISO[iso]) return 'rgba(120, 40, 50, 0.25)';
        return 'rgba(212, 184, 122, 0.18)';
      })
      .polygonAltitude((d: GeoFeature) => {
        const iso = d.properties.ISO_A3 || '';
        if (selectedIso && iso === selectedIso) return 0.04;
        if (focusIso && iso === focusIso) return 0.04;
        if (UNVISITED_ISO[iso]) return 0.004;
        return 0.009;
      })
      .polygonStrokeColor(() => theme.stroke);
  };

  const flyTo = (iso: string, altitude = 1.6) => {
    const target = features.find((d) => d.properties.ISO_A3 === iso);
    if (!target) return;
    const coords = flatten(target.geometry.coordinates);
    if (!coords.length) return;
    let lng = 0, lat = 0;
    coords.forEach(([x, y]) => { lng += x; lat += y; });
    lng /= coords.length; lat /= coords.length;
    world.pointOfView({ lat, lng, altitude }, 1200);
  };

  const updateHoverCard = (p: GeoFeature | null) => {
    if (!hoverCard) return;
    if (!p) {
      hoverCard.style.opacity = '0';
      hoverCard.style.transform = 'translateX(-50%) translateY(8px)';
      return;
    }
    const iso = p.properties.ISO_A3 || '';
    const en = p.properties.ADMIN || p.properties.NAME || p.properties.name || '';
    const ar = UNVISITED_ISO[iso]?.ar || AR_NAMES[iso] || '';
    const isUnvisited = !!UNVISITED_ISO[iso];

    if (hoverStatus) {
      hoverStatus.textContent = isUnvisited ? '◇ لم تُزَر بعد' : '◆ زارها الرحّال';
      hoverStatus.style.color = isUnvisited ? '#c97070' : theme.accent;
    }
    if (hoverAr) {
      hoverAr.textContent = ar;
      hoverAr.style.display = ar ? '' : 'none';
    }
    if (hoverEn) hoverEn.textContent = en;
    if (hoverIso) hoverIso.textContent = iso || '—';

    hoverCard.style.opacity = '1';
    hoverCard.style.transform = 'translateX(-50%) translateY(0)';
  };

  const dateFmt = new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long' });

  const openPopup = (p: GeoFeature) => {
    if (!panel) return;
    const iso = p.properties.ISO_A3 || '';
    if (!iso) return;
    const payload = countryData[iso];
    const unvisited = UNVISITED_ISO[iso];

    const ar = unvisited?.ar || payload?.ar || AR_NAMES[iso] || p.properties.ADMIN || iso;
    if (panelAr) panelAr.textContent = ar;
    if (panelList) panelList.innerHTML = '';

    if (unvisited) {
      if (panelStatus) {
        panelStatus.textContent = '◇ لم تُزَر بعد';
        panelStatus.style.color = '#c97070';
      }
      if (panelCount) panelCount.textContent = '';
      if (panelEmpty) {
        panelEmpty.textContent = 'لم يزرها الرحّال بعد — الحكاية لم تُكتب.';
        panelEmpty.hidden = false;
      }
      if (panelList) panelList.hidden = true;
      if (panelMore) panelMore.hidden = true;
    } else if (payload && payload.posts.length > 0) {
      if (panelStatus) {
        panelStatus.textContent = '◆ من دفتر الرحلات';
        panelStatus.style.color = theme.accent;
      }
      if (panelCount) {
        const n = payload.posts.length;
        panelCount.textContent = n === 1 ? 'تدوينة واحدة' : n === 2 ? 'تدوينتان' : `${n} تدوينات`;
      }
      if (panelEmpty) panelEmpty.hidden = true;
      if (panelList) {
        panelList.hidden = false;
        payload.posts.forEach((post) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/blog/${post.s}/`;

          if (post.i) {
            const img = document.createElement('img');
            img.className = 'rh-popup-post-img';
            img.src = post.i;
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', () => {
              const ph = document.createElement('span');
              ph.className = 'rh-popup-post-img rh-popup-post-noimg';
              ph.textContent = '✦';
              img.replaceWith(ph);
            });
            a.appendChild(img);
          } else {
            const ph = document.createElement('span');
            ph.className = 'rh-popup-post-img rh-popup-post-noimg';
            ph.textContent = '✦';
            a.appendChild(ph);
          }

          const text = document.createElement('span');
          text.className = 'rh-popup-post-text';
          const title = document.createElement('span');
          title.className = 'rh-popup-post-title';
          title.textContent = post.t;
          const date = document.createElement('span');
          date.className = 'rh-popup-post-date';
          const parsed = new Date(post.d);
          date.textContent = isNaN(parsed.getTime()) ? post.d : dateFmt.format(parsed);
          text.append(title, date);
          a.appendChild(text);
          li.appendChild(a);
          panelList.appendChild(li);
        });
        panelList.scrollTop = 0;
      }
      if (panelMore) {
        panelMore.hidden = !payload.url;
        if (payload.url) panelMore.href = payload.url;
      }
    } else {
      if (panelStatus) {
        panelStatus.textContent = '◆ زارها الرحّال';
        panelStatus.style.color = theme.accent;
      }
      if (panelCount) panelCount.textContent = '';
      if (panelEmpty) {
        panelEmpty.textContent = 'لا توجد تدوينات عن هذه الوجهة بعد.';
        panelEmpty.hidden = false;
      }
      if (panelList) panelList.hidden = true;
      if (panelMore) panelMore.hidden = true;
    }

    panel.hidden = false;
    selectedIso = iso;
    applyPolygons();
    flyTo(iso);
    ctrls.autoRotate = false;
    updateHoverCard(null);
  };

  const closePopup = () => {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    selectedIso = null;
    applyPolygons();
    ctrls.autoRotate = true;
  };

  panelClose?.addEventListener('click', closePopup);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopup();
  });

  // Load countries
  loadCountryFeatures()
    .then((feats) => {
      features = feats;
      world.polygonsData(features);
      applyPolygons();
      world.onPolygonHover((p: GeoFeature | null) => {
        hovered = p;
        document.body.style.cursor = p ? 'crosshair' : 'default';
        applyPolygons();
        if (!selectedIso) updateHoverCard(p);
      });
      let lastPolygonClick = 0;
      world.onPolygonClick((p: GeoFeature | null) => {
        lastPolygonClick = performance.now();
        if (p) openPopup(p);
        else closePopup();
      });
      // ocean click closes the panel; guard in case both events fire for one click
      world.onGlobeClick(() => {
        if (performance.now() - lastPolygonClick < 50) return;
        closePopup();
      });
    })
    .catch((err) => console.error('[atlas] geojson load failed', err));

  // Listen to unvisited list hover events from page DOM
  document.querySelectorAll<HTMLElement>('[data-rh-iso]').forEach((el) => {
    const iso = el.dataset.rhIso!;
    el.addEventListener('mouseenter', () => {
      focusIso = iso;
      el.classList.add('rh-uv-item-hot');
      applyPolygons();
      flyTo(iso);
    });
    el.addEventListener('mouseleave', () => {
      focusIso = null;
      el.classList.remove('rh-uv-item-hot');
      applyPolygons();
    });
  });
}
