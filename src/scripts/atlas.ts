import Globe from 'globe.gl';
import * as topojson from 'topojson-client';
import { UNVISITED_ISO, AR_NAMES, NUM_TO_A3, MIDNIGHT_THEME } from '../data/atlas';

type GeoFeature = {
  id?: string | number;
  geometry: { type: string; coordinates: any };
  properties: {
    ISO_A3?: string;
    ADMIN?: string;
    NAME?: string;
    name?: string;
  };
};

const theme = MIDNIGHT_THEME;

function flatten(c: any): [number, number][] {
  if (!Array.isArray(c)) return [];
  if (typeof c[0] === 'number') return [c as [number, number]];
  return c.flatMap(flatten);
}

export function initAtlas(containerEl: HTMLElement) {
  const hoverCard = document.getElementById('rh-hover-card');
  const hoverStatus = document.getElementById('rh-hover-status');
  const hoverAr = document.getElementById('rh-hover-ar');
  const hoverEn = document.getElementById('rh-hover-en');
  const hoverIso = document.getElementById('rh-hover-iso');

  let hovered: GeoFeature | null = null;
  let focusIso: string | null = null;
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
        if (focusIso && iso === focusIso) return 0.04;
        if (UNVISITED_ISO[iso]) return 0.004;
        return 0.009;
      })
      .polygonStrokeColor(() => theme.stroke);
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

  // Load countries
  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then((r) => r.json())
    .then((topo: any) => {
      const collection = (topojson as any).feature(topo, topo.objects.countries) as any;
      features = collection.features as GeoFeature[];
      features.forEach((f) => {
        const alpha3 = NUM_TO_A3[String(f.id)] || '';
        f.properties = f.properties || {};
        f.properties.ISO_A3 = alpha3;
        f.properties.ADMIN = f.properties.name || f.properties.ADMIN;
        f.properties.NAME = f.properties.name;
      });
      world.polygonsData(features);
      applyPolygons();
      world.onPolygonHover((p: GeoFeature | null) => {
        hovered = p;
        document.body.style.cursor = p ? 'crosshair' : 'default';
        applyPolygons();
        updateHoverCard(p);
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
      const target = features.find((d) => d.properties.ISO_A3 === iso);
      if (!target) return;
      const coords = flatten(target.geometry.coordinates);
      if (!coords.length) return;
      let lng = 0, lat = 0;
      coords.forEach(([x, y]) => { lng += x; lat += y; });
      lng /= coords.length; lat /= coords.length;
      world.pointOfView({ lat, lng, altitude: 1.6 }, 1200);
    });
    el.addEventListener('mouseleave', () => {
      focusIso = null;
      el.classList.remove('rh-uv-item-hot');
      applyPolygons();
    });
  });
}
