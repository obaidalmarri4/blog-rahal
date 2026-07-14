import Globe from 'globe.gl';
import { UNVISITED_ISO, MIDNIGHT_THEME } from '../data/atlas';
import { loadCountryFeatures, type GeoFeature } from './atlas';

const theme = MIDNIGHT_THEME;

export function initMiniGlobe(containerEl: HTMLElement, altitude = 2.0) {
  const world: any = (Globe as any)()(containerEl);
  world
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor(theme.atmosphere)
    .atmosphereAltitude(0.18)
    .showGraticules(false)
    .polygonsTransitionDuration(0)
    .polygonLabel(() => '');

  const fitSize = () => {
    const r = containerEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) world.width(r.width).height(r.height);
  };
  fitSize();
  window.addEventListener('resize', fitSize);

  const m = world.globeMaterial();
  m.color.setStyle(theme.ocean);
  if (m.emissive) m.emissive.setStyle(theme.ocean);
  m.emissiveIntensity = 0.15;
  m.shininess = 0.4;

  const ctrls = world.controls();
  ctrls.autoRotate = true;
  ctrls.autoRotateSpeed = 0.6;
  ctrls.enableZoom = false;
  ctrls.enablePan = false;
  ctrls.enableRotate = false;

  world.pointOfView({ lat: 24, lng: 45, altitude }, 0);

  loadCountryFeatures()
    .then((features) => {
      world
        .polygonsData(features)
        .polygonCapColor((d: GeoFeature) => {
          const iso = d.properties.ISO_A3 || '';
          return UNVISITED_ISO[iso] ? theme.unvisited : theme.visited;
        })
        .polygonSideColor((d: GeoFeature) => {
          const iso = d.properties.ISO_A3 || '';
          if (UNVISITED_ISO[iso]) return 'rgba(120, 40, 50, 0.25)';
          return 'rgba(212, 184, 122, 0.18)';
        })
        .polygonAltitude((d: GeoFeature) => {
          const iso = d.properties.ISO_A3 || '';
          return UNVISITED_ISO[iso] ? 0.004 : 0.009;
        })
        .polygonStrokeColor(() => theme.stroke);
    })
    .catch((err) => console.error('[mini-globe] geojson load failed', err));
}
