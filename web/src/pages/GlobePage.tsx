// The home page: a globe drawn like an old printed atlas on parchment. Spin
// it, click a country to land there, and hover the pins to see its crafts.

import Globe, { type GlobeInstance } from 'globe.gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MeshLambertMaterial } from 'three';
import { community, type Creation } from '../community/api';
import { DEFAULT_PLACE } from '../community/places';
import { CRAFTS, craftById, type CraftInfo } from '../crafts/catalog';
import { ATLAS_INKS, CRAFT_INK, fadeLimb, graticule, INK, inked, labelElement, mapLabels, seaTexture, zoomBand, type MapLabel } from '../globe/atlas';
import { altitudeForSpan, countryAt, countryView, distanceKm, loadCountries, mapColours, type CountryFeature } from '../globe/geo';
import { CreationThumb } from '../ui/Thumbnails';

type Pin =
  | { id: string; kind: 'craft'; lat: number; lng: number; craft: CraftInfo }
  | { id: string; kind: 'creation'; lat: number; lng: number; creation: Creation }
  /** Zoomed out, a crowded country collapses into one pin; clicking it lands there. */
  | { id: string; kind: 'cluster'; lat: number; lng: number; country: string; crafts: CraftInfo[]; creations: Creation[] };

const HOME_POV = { lat: 50, lng: 14, altitude: 2.3 };
const CARD_W = 300;
/** Above this camera altitude (globe radii), crowded countries are clustered. */
const CLUSTER_ABOVE = 1.3;
const UNCLUSTER_BELOW = 1.1;
const CLUSTER_MIN_PINS = 3;
const CRAFT_COUNTRIES = new Set(CRAFTS.map((c) => c.country));
/** Country cap materials, one per colour, lit so the globe shades towards its edge like a printed sphere. */
const capMaterials = new Map<string, MeshLambertMaterial>();
const capMaterial = (color: string) => {
  let m = capMaterials.get(color);
  if (!m) capMaterials.set(color, (m = new MeshLambertMaterial({ color })));
  return m;
};

const locationOf = (c: Creation) => c.location ?? DEFAULT_PLACE;
const countryName = (d: object) => (d as CountryFeature).properties.name;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Mean of points on the sphere (safe across the antimeridian). */
function sphericalMean(points: { lat: number; lng: number }[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const la = (p.lat * Math.PI) / 180;
    const lo = (p.lng * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

/**
 * Pins for crafts and creations. When `clustered`, any country with several
 * pins becomes one cluster pin (except `openCountry`, the one we've landed on).
 * Remaining pins are nudged apart where they would overlap.
 */
function buildPins(creations: Creation[], countryOf: Map<string, string | undefined>, clustered: boolean, openCountry?: string): Pin[] {
  let crafts = CRAFTS;
  let made = creations;
  const clusters: Pin[] = [];
  if (clustered) {
    const groups = new Map<string, { crafts: CraftInfo[]; creations: Creation[] }>();
    const group = (n: string) => groups.get(n) ?? groups.set(n, { crafts: [], creations: [] }).get(n)!;
    for (const c of CRAFTS) group(c.country).crafts.push(c);
    for (const c of creations) {
      const n = countryOf.get(c.id);
      if (n) group(n).creations.push(c);
    }
    const collapsed = new Set<string>();
    for (const [country, g] of groups) {
      if (country === openCountry || g.crafts.length + g.creations.length < CLUSTER_MIN_PINS) continue;
      collapsed.add(country);
      const centre = sphericalMean([...g.crafts, ...g.creations.map(locationOf)]);
      clusters.push({ id: `cluster-${country}`, kind: 'cluster', ...centre, country, ...g });
    }
    crafts = CRAFTS.filter((c) => !collapsed.has(c.country));
    made = creations.filter((c) => !collapsed.has(countryOf.get(c.id) ?? ''));
  }
  const pins: Pin[] = [
    ...clusters,
    ...crafts.map((craft): Pin => ({ id: `craft-${craft.id}`, kind: 'craft', lat: craft.lat, lng: craft.lng, craft })),
    ...made.map((creation): Pin => ({ id: `creation-${creation.id}`, kind: 'creation', lat: locationOf(creation).lat, lng: locationOf(creation).lng, creation })),
  ];
  const placed: Pin[] = [];
  for (const pin of pins) {
    let k = 0;
    while (placed.some((p) => distanceKm(p, pin) < 45) && k < 12) {
      // Golden-angle spiral around the original spot.
      const a = k * 2.399963;
      const r = 0.55 * Math.sqrt(k + 1);
      pin.lat += Math.sin(a) * r * 0.5;
      pin.lng += (Math.cos(a) * r) / Math.max(0.3, Math.cos((pin.lat * Math.PI) / 180));
      k++;
    }
    placed.push(pin);
  }
  return placed;
}

function pinElement(pin: Pin, handlers: React.MutableRefObject<PinHandlers>): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pin pin-${pin.kind}${pin.kind === 'craft' ? ` pin-${pin.craft.status}` : ''}`;
  el.dataset.pinId = pin.id;
  if (pin.kind === 'cluster') {
    const n = pin.crafts.length + pin.creations.length;
    el.setAttribute('aria-label', `${pin.country}: ${n} crafts and creations`);
    el.innerHTML = `<span class="pin-core"></span><span class="pin-count">${n}</span>`;
  } else {
    el.setAttribute('aria-label', pin.kind === 'craft' ? pin.craft.name : pin.creation.title);
    el.innerHTML = pin.kind === 'craft' ? `<span class="pin-core"></span><span class="pin-name">${esc(pin.craft.name)}</span>` : '<span class="pin-core"></span>';
  }
  el.addEventListener('pointerenter', () => handlers.current.enter(pin));
  el.addEventListener('pointerleave', () => handlers.current.leave());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.current.click(pin);
  });
  // Keep the globe from treating pin interactions as drags/clicks on the map below.
  for (const type of ['pointerdown', 'pointerup', 'pointermove']) el.addEventListener(type, (e) => e.stopPropagation());
  return el;
}

interface PinHandlers {
  enter(pin: Pin): void;
  leave(): void;
  click(pin: Pin): void;
}

function CraftCard({ craft }: { craft: CraftInfo }) {
  return (
    <>
      <img src={craft.image.src} alt={craft.image.alt} />
      <div className="gc-body">
        <div className="gc-eyebrow">{craft.region}</div>
        <h3>
          {craft.name} <i>{craft.localName}</i>
        </h3>
        <p>{craft.blurb}</p>
        <div className="gc-skills">
          <span>Teaches a robot</span>
          {craft.robotSkills.map((s) => (
            <b key={s}>{s}</b>
          ))}
        </div>
        <div className="gc-foot">
          {craft.status === 'playable' ? (
            <Link className="btn small primary" to={craft.route!}>
              Learn it now →
            </Link>
          ) : (
            <span className="gc-soon">Coming to Senecai</span>
          )}
          <a className="gc-credit" href={craft.image.source} target="_blank" rel="noreferrer">
            Photo: {craft.image.author} · {craft.image.license}
          </a>
        </div>
      </div>
    </>
  );
}

function ClusterCard({ pin, onLand }: { pin: Extract<Pin, { kind: 'cluster' }>; onLand: () => void }) {
  const playable = pin.crafts.filter((c) => c.status === 'playable');
  return (
    <div className="gc-body">
      <div className="gc-eyebrow">{pin.country}</div>
      <h3>
        {pin.crafts.length} craft{pin.crafts.length === 1 ? '' : 's'} · {pin.creations.length} creation{pin.creations.length === 1 ? '' : 's'}
      </h3>
      {pin.crafts.length > 0 && (
        <div className="gc-mosaic">
          {pin.crafts.slice(0, 4).map((c) => (
            <img key={c.id} src={c.image.src} alt={c.name} title={c.name} />
          ))}
        </div>
      )}
      <p>
        {pin.crafts.map((c) => c.name).join(' · ')}
        {playable.length > 0 && (
          <>
            <br />
            <span className="gc-playable">Playable now: {playable.map((c) => c.name).join(' & ')}</span>
          </>
        )}
      </p>
      <div className="gc-foot">
        <button className="btn small primary" onClick={onLand}>
          Land in {pin.country} →
        </button>
      </div>
    </div>
  );
}

function CreationCard({ creation }: { creation: Creation }) {
  const craft = craftById(creation.craft);
  return (
    <>
      <div className="gc-thumb">
        <CreationThumb creation={creation} />
      </div>
      <div className="gc-body">
        <div className="gc-eyebrow lake">{locationOf(creation).place} · community</div>
        <h3>{creation.title}</h3>
        <p>
          {craft?.name} by {creation.author}
          {creation.score !== undefined ? ` · score ${creation.score}` : ''}
          {creation.learnedFrom ? ` · learned from ${creation.learnedFrom.author}` : ''}
        </p>
        {creation.description && <p className="gc-quote">"{creation.description}"</p>}
        <div className="gc-foot">
          <Link className="btn small primary" to={`/community/${creation.id}`}>
            Watch the robot
          </Link>
          <Link className="btn small" to={creation.craft === 'kantele' ? `/kantele?from=${creation.id}` : `/craft/${creation.craft}?from=${creation.id}`}>
            Learn this
          </Link>
        </div>
      </div>
    </>
  );
}

export default function GlobePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingCraftRef = useRef<CraftInfo | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const countries = useMemo(loadCountries, []);
  const inks = useMemo(() => mapColours(countries, ATLAS_INKS.length), [countries]);
  const labels = useMemo(() => mapLabels(countries), [countries]);
  const hoverRef = useRef<Pin | null>(null);
  const selectedRef = useRef<CountryFeature | null>(null);
  const hoverCountryRef = useRef<string | null>(null);
  const hideTimer = useRef(0);
  const flyTimer = useRef(0);
  const creationsRef = useRef<Creation[]>([]);
  /** Creation id -> country name, computed once per data load. */
  const creationCountryRef = useRef(new Map<string, string | undefined>());

  const [creations, setCreations] = useState<Creation[]>([]);
  const [hover, setHover] = useState<Pin | null>(null);
  const [selected, setSelected] = useState<CountryFeature | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [clustered, setClustered] = useState(true);
  const clusteredRef = useRef(true);
  const creationCountry = useMemo(
    () => new Map(creations.map((c) => [c.id, locationOf(c).country ?? countryAt(countries, locationOf(c).lat, locationOf(c).lng)])),
    [creations, countries],
  );
  creationCountryRef.current = creationCountry;

  const showCard = (pin: Pin) => {
    clearTimeout(hideTimer.current);
    hoverRef.current = pin;
    setHover(pin);
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hoverRef.current = null;
      setHover(null);
    }, 260);
  };
  const landIn = (country: string) => {
    const f = countries.find((c) => c.properties.name === country);
    if (f) selectRef.current(f);
  };
  const openPin = (pin: Pin) => {
    // First tap on touch screens just shows the card.
    if (hoverRef.current?.id !== pin.id) return showCard(pin);
    if (pin.kind === 'cluster') landIn(pin.country);
    else if (pin.kind === 'creation') navigate(`/community/${pin.creation.id}`);
    else if (pin.craft.route) navigate(pin.craft.route);
  };
  const handlers = useRef<PinHandlers>({ enter: showCard, leave: scheduleHide, click: openPin });
  handlers.current = { enter: showCard, leave: scheduleHide, click: openPin };

  const refreshPolygons = () => {
    const g = globeRef.current;
    if (!g) return;
    const hov = hoverCountryRef.current;
    const sel = selectedRef.current?.properties.name;
    g.polygonCapMaterial((d: object) => {
      const n = countryName(d);
      const fill = CRAFT_COUNTRIES.has(n) ? CRAFT_INK : ATLAS_INKS[inks.get(n) ?? 0];
      return capMaterial(n === sel ? inked(fill, 0.22) : n === hov ? inked(fill, 0.12) : fill);
    })
      .polygonSideColor((d: object) => (countryName(d) === hov || countryName(d) === sel ? 'rgba(78,61,43,0.45)' : 'rgba(0,0,0,0)'))
      .polygonAltitude((d: object) => (countryName(d) === sel ? 0.02 : countryName(d) === hov ? 0.014 : 0.005));
  };

  const selectCountry = (f: CountryFeature | null) => {
    const g = globeRef.current;
    if (!g) return;
    selectedRef.current = f;
    setSelected(f);
    hoverRef.current = null;
    setHover(null);
    // The country under the cursor changes while we fly, so drop the stale hover and hide tooltips until we land.
    hoverCountryRef.current = null;
    wrapRef.current?.classList.add('flying');
    clearTimeout(flyTimer.current);
    flyTimer.current = window.setTimeout(() => wrapRef.current?.classList.remove('flying'), 1400);
    // Keep the landed country centred in the space beside the panel.
    const offset = f && (wrapRef.current?.clientWidth ?? 0) > 900 ? 180 : 0;
    g.globeOffset([offset, 0]);
    if (f) {
      const v = countryView(f);
      g.pointOfView({ lat: v.lat, lng: v.lng, altitude: altitudeForSpan(v.spanDeg) }, 1300);
    } else {
      g.pointOfView({ ...g.pointOfView(), altitude: HOME_POV.altitude }, 1100);
    }
    refreshPolygons();
  };
  const selectRef = useRef(selectCountry);
  selectRef.current = selectCountry;

  /** Click outside / Escape: close any open card and zoom back out to the whole world. */
  const dismiss = () => {
    clearTimeout(hideTimer.current);
    hoverRef.current = null;
    setHover(null);
    setAboutOpen(false);
    if (selectedRef.current) selectCountry(null);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Create the globe once.
  useEffect(() => {
    const mount = mountRef.current!;
    const wrap = wrapRef.current!;

    const g = new Globe(mount, { animateIn: true, rendererConfig: { antialias: true, alpha: true } })
      // Transparent: the parchment behind the canvas is the page itself.
      .backgroundColor('rgba(0,0,0,0)')
      .globeMaterial(new MeshLambertMaterial({ map: seaTexture() }))
      .showAtmosphere(false)
      .polygonsData(countries)
      .polygonsTransitionDuration(260)
      .polygonStrokeColor(() => INK)
      .pathsData(graticule())
      .pathPoints('pts')
      .pathPointLat((p: [number, number]) => p[0])
      .pathPointLng((p: [number, number]) => p[1])
      .pathPointAlt(0.0062)
      .pathColor(() => 'rgba(78,61,43,0.22)')
      .pathStroke(null)
      .pathTransitionDuration(0)
      .polygonLabel((d: object) => {
        const name = countryName(d);
        const crafts = CRAFTS.filter((c) => c.country === name).length;
        const made = creationsRef.current.filter((c) => creationCountryRef.current.get(c.id) === name).length;
        const parts = [crafts && `${crafts} craft${crafts > 1 ? 's' : ''}`, made && `${made} creation${made > 1 ? 's' : ''}`].filter(Boolean);
        return `<div class="country-tip"><b>${esc(name)}</b><span>${parts.length ? parts.join(' · ') : 'click to land'}</span></div>`;
      })
      .onPolygonHover((d: object | null) => {
        hoverCountryRef.current = d ? countryName(d) : null;
        refreshPolygons();
      })
      .onZoom(({ altitude }) => {
        // Letter more of the map the closer you are.
        const band = zoomBand(altitude);
        if (wrap.dataset.zoom !== band) wrap.dataset.zoom = band;
        fadeLimb(mount, g.pointOfView());
        const want = altitude > CLUSTER_ABOVE ? true : altitude < UNCLUSTER_BELOW ? false : clusteredRef.current;
        if (want !== clusteredRef.current) {
          clusteredRef.current = want;
          setClustered(want);
        }
      })
      .htmlElementsData([])
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.008)
      .htmlElement((d: object) => ((d as MapLabel).kind === 'label' ? labelElement(d as MapLabel) : pinElement(d as Pin, handlers)))
      .htmlElementVisibilityModifier((el: HTMLElement, visible: boolean) => el.classList.toggle('pin-hidden', !visible))
      .pointOfView(HOME_POV, 0);
    globeRef.current = g;
    if (import.meta.env.DEV) (window as unknown as { senecaiGlobe: GlobeInstance }).senecaiGlobe = g;
    refreshPolygons();

    g.renderer().setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const controls = g.controls();
    controls.autoRotate = false;
    controls.maxDistance = 100 * (1 + 4);

    wrap.dataset.zoom = zoomBand(HOME_POV.altitude);

    const ro = new ResizeObserver(() => g.width(wrap.clientWidth).height(wrap.clientHeight));
    ro.observe(wrap);

    // Clicks (not drags) on the map. We work out what is under the cursor ourselves rather than
    // use globe.gl's click callbacks: those ignore empty space and lag behind the pointer.
    //  - world view: a country lands there; ocean or space does nothing.
    //  - focused on a country: anything outside it (another country, ocean, space) zooms back out.
    // Pins stop their own events, so they never reach here.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const dragged = !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
      down = null;
      if (dragged || e.button !== 0) return;
      const rect = mount.getBoundingClientRect();
      const at = g.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top);
      const name = at ? countryAt(countries, at.lat, at.lng) : undefined;
      const sel = selectedRef.current;
      if (sel) {
        if (name !== sel.properties.name) dismissRef.current();
      } else if (name) {
        const f = countries.find((c) => c.properties.name === name);
        if (f) selectRef.current(f);
      }
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || t?.closest('input, textarea, select')) return;
      dismissRef.current();
    };
    window.addEventListener('keydown', onKey);

    // Per-frame: keep the hover card pinned to its dot.
    let raf = 0;
    let fadedAt = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // Labels are created by globe.gl on its own schedule; keep their edge-fade current.
      const now = performance.now();
      if (now - fadedAt > 250) {
        fadedAt = now;
        fadeLimb(mount, g.pointOfView());
      }
      const pin = hoverRef.current;
      const card = cardRef.current;
      const leader = leaderRef.current;
      if (!pin || !card || !leader) return;
      const { x, y } = g.getScreenCoords(pin.lat, pin.lng, 0.008);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const ch = card.offsetHeight;
      const right = x + 28 + CARD_W < w - 12;
      const left = right ? x + 28 : x - 28 - CARD_W;
      const top = Math.min(h - ch - 14, Math.max(76, y - ch * 0.32));
      card.style.transform = `translate(${left}px, ${top}px)`;
      // Leader line from the dot to the card's edge.
      const ex = right ? left : left + CARD_W;
      const ey = Math.min(top + ch - 20, Math.max(top + 20, y));
      const len = Math.hypot(ex - x, ey - y);
      leader.style.width = `${len}px`;
      leader.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(ey - y, ex - x)}rad)`;
      const hidden = !!mount.querySelector(`[data-pin-id="${pin.id}"].pin-hidden`);
      card.style.opacity = leader.style.opacity = hidden ? '0' : '1';
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      g.pauseAnimation();
      g._destructor();
      globeRef.current = null;
      mount.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void community.list().then((list) => !cancelled && setCreations(list));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    creationsRef.current = creations;
  }, [creations]);

  const openCountry = selected?.properties.name;
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    // Only crafts are pinned; community creations are listed in the country panel instead.
    const pins = buildPins([], new Map(), clustered, openCountry);
    g.htmlElementsData([...labels, ...pins]);
    // New elements start visible; settle which side of the globe they're on.
    requestAnimationFrame(() => mountRef.current && fadeLimb(mountRef.current, g.pointOfView()));
    // Pin objects are rebuilt: keep an open card on its new pin, or close it if that pin is gone.
    // A craft picked from search only gets a pin once we've landed in its country.
    const pending = pendingCraftRef.current;
    if (pending && pending.country === openCountry) pendingCraftRef.current = null;
    const wantId = pending && pending.country === openCountry ? `craft-${pending.id}` : hoverRef.current?.id;
    const next = wantId ? pins.find((p) => p.id === wantId) : undefined;
    if (next) showCard(next);
    else {
      hoverRef.current = null;
      setHover(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clustered, openCountry]);

  // Search results arrive as `/?country=…` or `/?craft=…`.
  useEffect(() => {
    const country = searchParams.get('country');
    const craft = searchParams.get('craft') ? craftById(searchParams.get('craft')!) : undefined;
    if (!country && !craft) return;
    setSearchParams({}, { replace: true });
    if (craft) {
      pendingCraftRef.current = craft;
      if (selectedRef.current?.properties.name === craft.country) {
        pendingCraftRef.current = null;
        focusCraft(craft);
      } else landIn(craft.country);
    } else if (country) landIn(country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const here = useMemo(() => {
    if (!selected) return null;
    const name = selected.properties.name;
    return {
      name,
      crafts: CRAFTS.filter((c) => c.country === name),
      creations: creations.filter((c) => creationCountry.get(c.id) === name),
    };
  }, [selected, creations, creationCountry]);

  const focusCraft = (craft: CraftInfo) => {
    const pin = globeRef.current?.htmlElementsData().find((p) => (p as Pin).id === `craft-${craft.id}`) as Pin | undefined;
    if (pin) showCard(pin);
  };

  return (
    <div className={`globe-page ${hover ? 'card-open' : ''}`} ref={wrapRef}>
      <div className="globe-mount" ref={mountRef} />

      {here && (
        <aside className="country-panel">
          <button className="country-back" onClick={() => selectCountry(null)}>
            ← the whole world
          </button>
          <h2>{here.name}</h2>
          <div className="country-count">
            {here.crafts.length} craft{here.crafts.length === 1 ? '' : 's'} · {here.creations.length} creation{here.creations.length === 1 ? '' : 's'}
          </div>
          {here.crafts.length > 0 && (
            <ul className="country-list">
              {here.crafts.map((c) => (
                <li key={c.id}>
                  <button onMouseEnter={() => focusCraft(c)} onMouseLeave={scheduleHide} onClick={() => (c.route ? navigate(c.route) : focusCraft(c))}>
                    <img src={c.image.src} alt="" />
                    <span>
                      <b>{c.name}</b>
                      <small>{c.region}</small>
                    </span>
                    <em className={c.status}>{c.status === 'playable' ? 'play' : 'soon'}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {here.creations.length > 0 && (
            <>
              <h4>Made here</h4>
              <ul className="country-list creations">
                {here.creations.map((c) => (
                  <li key={c.id}>
                    <Link to={`/community/${c.id}`}>
                      <span>
                        <b>{c.title}</b>
                        <small>
                          {craftById(c.craft)?.name} · {c.author}
                        </small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!here.crafts.length && !here.creations.length && (
            <p className="country-empty">No crafts mapped in {here.name} yet. Every recording shared from here puts it on the map.</p>
          )}
        </aside>
      )}

      <div ref={leaderRef} className="globe-leader" style={{ display: hover ? 'block' : 'none' }} />
      <div ref={cardRef} className="globe-card" style={{ display: hover ? 'block' : 'none' }} onPointerEnter={() => clearTimeout(hideTimer.current)} onPointerLeave={scheduleHide}>
        {hover && (
          <div key={hover.id} className="gc-inner">
            {hover.kind === 'craft' && <CraftCard craft={hover.craft} />}
            {hover.kind === 'creation' && <CreationCard creation={hover.creation} />}
            {hover.kind === 'cluster' && <ClusterCard pin={hover} onLand={() => landIn(hover.country)} />}
          </div>
        )}
      </div>
    </div>
  );
}
