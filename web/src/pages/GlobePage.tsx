// The home page: a globe drawn like an old printed atlas on parchment. Spin
// it, click a country to land there, and hover the pins to see its crafts.

import Globe, { type GlobeInstance } from 'globe.gl';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MeshLambertMaterial, type Object3D } from 'three';
import { CRAFTS, craftById, type CraftInfo } from '../crafts/catalog';
import { ATLAS_INKS, CRAFT_INK, labelElement, mapLabels, seaTexture, zoomBand } from '../globe/atlas';
import { altitudeForSpan, countryAt, countryView, distanceKm, loadCountries, mapColours, type CountryFeature } from '../globe/geo';
import { createCountryIndex } from '../globe/hit';
import { createAtlasLayers, type AtlasLayers } from '../globe/layers';
import { createRenderLoop, tryFindGlobeObject, type RenderLoop } from '../globe/loop';
import { createOverlay, createTooltip, type Overlay, type OverlayItem } from '../globe/overlay';
import { globeCoordsAt } from '../globe/pick';
import { createGlobeShadow } from '../globe/shadow';

type Pin =
  | { id: string; kind: 'craft'; lat: number; lng: number; craft: CraftInfo }
  /** Zoomed out, a crowded country collapses into one pin; clicking it lands there. */
  | { id: string; kind: 'cluster'; lat: number; lng: number; country: string; crafts: CraftInfo[] };

const HOME_POV = { lat: 50, lng: 14, altitude: 2.3 };
const CARD_W = 300;
/** Above this camera altitude (globe radii), crowded countries are clustered. */
const CLUSTER_ABOVE = 1.3;
const UNCLUSTER_BELOW = 1.1;
const CLUSTER_MIN_PINS = 3;
const CRAFT_COUNTRIES = new Set(CRAFTS.map((c) => c.country));
/** Map labels and pins sit just above the country caps. */
const HTML_ALT = 0.008;

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
 * Pins for crafts. When `clustered`, any country with several pins becomes one
 * cluster pin (except `openCountry`, the one we've landed on). Remaining pins
 * are nudged apart where they would overlap.
 */
function buildPins(clustered: boolean, openCountry?: string): Pin[] {
  let crafts = CRAFTS;
  const clusters: Pin[] = [];
  if (clustered) {
    const groups = new Map<string, CraftInfo[]>();
    for (const c of CRAFTS) groups.set(c.country, [...(groups.get(c.country) ?? []), c]);
    const collapsed = new Set<string>();
    for (const [country, g] of groups) {
      if (country === openCountry || g.length < CLUSTER_MIN_PINS) continue;
      collapsed.add(country);
      clusters.push({ id: `cluster-${country}`, kind: 'cluster', ...sphericalMean(g), country, crafts: g });
    }
    crafts = CRAFTS.filter((c) => !collapsed.has(c.country));
  }
  const pins: Pin[] = [...clusters, ...crafts.map((craft): Pin => ({ id: `craft-${craft.id}`, kind: 'craft', lat: craft.lat, lng: craft.lng, craft }))];
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
    const n = pin.crafts.length;
    el.setAttribute('aria-label', `${pin.country}: ${n} crafts`);
    el.innerHTML = `<span class="pin-core"></span><span class="pin-count">${n}</span>`;
  } else {
    el.setAttribute('aria-label', pin.craft.name);
    el.innerHTML = `<span class="pin-core"></span><span class="pin-name">${esc(pin.craft.name)}</span>`;
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
      {craft.image && <img src={craft.image.src} alt={craft.image.alt} />}
      <div className="gc-body">
        <div className="gc-eyebrow">{craft.region}</div>
        <h3>
          {craft.name} <i>{craft.localName}</i>
        </h3>
        <p>{craft.blurb}</p>
        <div className="gc-foot">
          {craft.status === 'playable' ? (
            <Link className="btn small primary" to={craft.route!}>
              Learn it now →
            </Link>
          ) : (
            <span className="gc-soon">Coming to Senecai</span>
          )}
          {craft.image && (
            <a className="gc-credit" href={craft.image.source} target="_blank" rel="noreferrer">
              Photo: {craft.image.author} · {craft.image.license}
            </a>
          )}
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
        {pin.crafts.length} craft{pin.crafts.length === 1 ? '' : 's'}
      </h3>
      {pin.crafts.some((c) => c.image) && (
        <div className="gc-mosaic">
          {pin.crafts
            .filter((c) => c.image)
            .slice(0, 4)
            .map((c) => (
              <img key={c.id} src={c.image!.src} alt={c.name} title={c.name} />
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

export default function GlobePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingCraftRef = useRef<CraftInfo | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const loopRef = useRef<RenderLoop | null>(null);
  const layersRef = useRef<AtlasLayers | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const pinsRef = useRef<Pin[]>([]);
  const itemsRef = useRef<OverlayItem[]>([]);
  const pendingFlyRef = useRef<((loop: RenderLoop) => void) | null>(null);
  const countries = useMemo(loadCountries, []);
  const inks = useMemo(() => mapColours(countries, ATLAS_INKS.length), [countries]);
  const labels = useMemo(() => mapLabels(countries), [countries]);
  const hoverRef = useRef<Pin | null>(null);
  const selectedRef = useRef<CountryFeature | null>(null);
  const hoverCountryRef = useRef<string | null>(null);
  const hideTimer = useRef(0);
  const flyTimer = useRef(0);

  const [hover, setHover] = useState<Pin | null>(null);
  const [selected, setSelected] = useState<CountryFeature | null>(null);
  const [clustered, setClustered] = useState(true);
  const clusteredRef = useRef(true);

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
    else if (pin.craft.route) navigate(pin.craft.route);
  };
  // Pin elements outlive rebuilds of the pin list (the overlay keeps elements by id), so resolve the current pin.
  const currentPin = (pin: Pin) => pinsRef.current.find((p) => p.id === pin.id) ?? pin;
  const pinHandlers = (): PinHandlers => ({ enter: (p) => showCard(currentPin(p)), leave: scheduleHide, click: (p) => openPin(currentPin(p)) });
  const handlers = useRef<PinHandlers>(pinHandlers());
  handlers.current = pinHandlers();

  /** Raise and darken the hovered and selected countries. */
  const refreshPolygons = () => {
    layersRef.current?.setHighlight(hoverCountryRef.current, selectedRef.current?.properties.name ?? null);
    loopRef.current?.invalidate();
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
    const fly = (loop: RenderLoop) => {
      if (f) {
        const v = countryView(f);
        loop.flyTo({ lat: v.lat, lng: v.lng, altitude: altitudeForSpan(v.spanDeg) }, 1300);
      } else {
        loop.flyTo({ ...g.pointOfView(), altitude: HOME_POV.altitude }, 1100);
      }
    };
    // A deep link can select before the render loop exists (it waits on globe.gl); fly once it does.
    if (loopRef.current) fly(loopRef.current);
    else pendingFlyRef.current = fly;
    tooltipHideRef.current();
    refreshPolygons();
  };
  const selectRef = useRef(selectCountry);
  selectRef.current = selectCountry;

  /** Click outside / Escape: close any open card and zoom back out to the whole world. */
  const dismiss = () => {
    clearTimeout(hideTimer.current);
    hoverRef.current = null;
    setHover(null);
    if (selectedRef.current) selectCountry(null);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const tooltipHideRef = useRef(() => {});

  // Create the globe once.
  useEffect(() => {
    const mount = mountRef.current!;
    const wrap = wrapRef.current!;

    // Countries, borders, graticule, labels and pins are drawn by our own merged layers (globe/layers.ts,
    // globe/overlay.ts) rather than globe.gl's per-object layers, and globe.gl's always-on loop is paused in
    // favour of an on-demand one (globe/loop.ts). globe.gl still provides the scene, camera, controls and sea.
    const g = new Globe(mount, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
      // Transparent: the parchment behind the canvas is the page itself.
      .backgroundColor('rgba(0,0,0,0)')
      .globeMaterial(new MeshLambertMaterial({ map: seaTexture() }))
      .showAtmosphere(false)
      .onZoom(({ altitude }) => {
        // Letter more of the map the closer you are.
        const band = zoomBand(altitude);
        if (wrap.dataset.zoom !== band) wrap.dataset.zoom = band;
        const want = altitude > CLUSTER_ABOVE ? true : altitude < UNCLUSTER_BELOW ? false : clusteredRef.current;
        if (want !== clusteredRef.current) {
          clusteredRef.current = want;
          setClustered(want);
        }
      })
      .pointOfView(HOME_POV, 0);
    g.pauseAnimation();
    globeRef.current = g;
    if (import.meta.env.DEV) (window as unknown as { senecaiGlobe: GlobeInstance }).senecaiGlobe = g;

    g.renderer().setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const controls = g.controls();
    controls.autoRotate = false;
    controls.maxDistance = 100 * (1 + 4);

    // globe.gl adds its ThreeGlobe object to the scene in a debounced update just after construction;
    // everything below hangs off it, so wait for it (a frame at most).
    let cleanupInit = () => {};
    let globeReady = false;
    let onReady = () => {};
    g.onGlobeReady(() => {
      globeReady = true;
      onReady();
    });
    let waitRaf = 0;
    const waitForGlobe = () => {
      const globeObj = tryFindGlobeObject(g);
      if (globeObj) cleanupInit = init(globeObj);
      else waitRaf = requestAnimationFrame(waitForGlobe);
    };
    const init = (globeObj: Object3D) => {
      const layers = createAtlasLayers(countries, (n) => (CRAFT_COUNTRIES.has(n) ? CRAFT_INK : ATLAS_INKS[inks.get(n) ?? 0]));
      globeObj.add(layers.object);
      layersRef.current = layers;

      const sceneEl = g.renderer().domElement.parentElement!;
      const overlay = createOverlay();
      sceneEl.appendChild(overlay.root);
      overlayRef.current = overlay;
      overlay.setItems(itemsRef.current);
      const tooltip = createTooltip(sceneEl);
      tooltipHideRef.current = () => tooltip.hide();
      // The soft printed shadow and inked rim, as a cheap element behind the canvas instead of a CSS filter on it.
      const shadow = createGlobeShadow();
      mount.insertBefore(shadow.el, mount.firstChild);

      // Size the canvas to the page before the first frame (otherwise it starts window-sized).
      // Page size and position, cached so per-frame and per-pointer-move code never reads layout.
      const size = { w: wrap.clientWidth, h: wrap.clientHeight, left: 0, top: 0 };
      const measure = () => {
        const r = mount.getBoundingClientRect();
        size.w = wrap.clientWidth;
        size.h = wrap.clientHeight;
        size.left = r.left;
        size.top = r.top;
      };
      measure();
      g.width(size.w).height(size.h);
      const loop = createRenderLoop(g);
      loopRef.current = loop;
      refreshPolygons();
      pendingFlyRef.current?.(loop);
      pendingFlyRef.current = null;

      wrap.dataset.zoom = zoomBand(HOME_POV.altitude);

      const ro = new ResizeObserver(() => {
        measure();
        g.width(size.w).height(size.h);
        loop.invalidate();
      });
      ro.observe(wrap);

      // Hover: which country is under the pointer, worked out at most once a frame from the pointer position
      // (globe.gl raycast every country mesh every 50ms, even with the mouse still). Not while dragging.
      const index = createCountryIndex(countries);
      const tipHtml = (name: string) => {
        const crafts = CRAFTS.filter((c) => c.country === name).length;
        return `<div class="country-tip"><b>${esc(name)}</b><span>${crafts ? `${crafts} craft${crafts > 1 ? 's' : ''}` : 'click to land'}</span></div>`;
      };
      let hoverRaf = 0;
      let lastMove: PointerEvent | null = null;
      const updateHover = () => {
        hoverRaf = 0;
        const e = lastMove;
        if (!e) return;
        const at = globeCoordsAt(g.camera(), globeObj, e.clientX - size.left, e.clientY - size.top, size.w, size.h);
        const name = at ? (index.at(at.lat, at.lng) ?? null) : null;
        if (name !== hoverCountryRef.current) {
          hoverCountryRef.current = name;
          refreshPolygons();
        }
        if (name) tooltip.show(tipHtml(name), e.clientX, e.clientY);
        else tooltip.hide();
      };
      const onMove = (e: PointerEvent) => {
        if (e.buttons) return;
        lastMove = e;
        if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHover);
      };
      const onLeave = () => {
        lastMove = null;
        cancelAnimationFrame(hoverRaf);
        hoverRaf = 0;
        tooltip.hide();
        if (hoverCountryRef.current) {
          hoverCountryRef.current = null;
          refreshPolygons();
        }
      };
      mount.addEventListener('pointermove', onMove);
      mount.addEventListener('pointerleave', onLeave);

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
        const at = globeCoordsAt(g.camera(), globeObj, e.clientX - size.left, e.clientY - size.top, size.w, size.h);
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

      // Per rendered frame (the loop only renders when something changed).
      const removeTicker = loop.addTicker((f) => {
        const { w, h } = size;
        shadow.update(g.camera(), globeObj, w, h);
        overlay.update(g.camera(), globeObj, w, h, zoomBand(g.pointOfView().altitude));
        // Keep the hover card pinned to its dot.
        const pin = hoverRef.current;
        const card = cardRef.current;
        const leader = leaderRef.current;
        if (pin && card && leader) {
          const { x, y } = g.getScreenCoords(pin.lat, pin.lng, HTML_ALT);
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
          card.style.opacity = leader.style.opacity = overlay.isHidden(pin.id) ? '0' : '1';
        }
        return layers.update(f.now);
      });
      // three-globe signals readiness asynchronously; play its build-in animation then.
      if (globeReady) loop.playIntro();
      else onReady = () => loop.playIntro();
      return () => {
        removeTicker();
        cancelAnimationFrame(hoverRaf);
        loop.dispose();
        ro.disconnect();
        mount.removeEventListener('pointermove', onMove);
        mount.removeEventListener('pointerleave', onLeave);
        mount.removeEventListener('pointerdown', onDown);
        mount.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        tooltipHideRef.current = () => {};
        tooltip.dispose();
        overlay.dispose();
        layers.dispose();
        shadow.el.remove();
        loopRef.current = null;
        layersRef.current = null;
        overlayRef.current = null;
      };
    };
    waitForGlobe();

    return () => {
      cancelAnimationFrame(waitRaf);
      cleanupInit();
      g._destructor();
      globeRef.current = null;
      mount.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCountry = selected?.properties.name;
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const pins = buildPins(clustered, openCountry);
    pinsRef.current = pins;
    const items: OverlayItem[] = [
      ...labels.map((l): OverlayItem => ({ id: l.id, lat: l.lat, lng: l.lng, alt: HTML_ALT, kind: 'label', tier: l.tier, style: l.style, make: () => labelElement(l) })),
      ...pins.map((p): OverlayItem => ({ id: p.id, lat: p.lat, lng: p.lng, alt: HTML_ALT, kind: 'pin', make: () => pinElement(p, handlers) })),
    ];
    itemsRef.current = items;
    overlayRef.current?.setItems(items);
    loopRef.current?.invalidate();
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

  // The hover card is positioned by the render loop; give it a frame when it opens or changes.
  useLayoutEffect(() => loopRef.current?.invalidate(), [hover]);

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
    };
  }, [selected]);

  const focusCraft = (craft: CraftInfo) => {
    const pin = pinsRef.current.find((p) => p.id === `craft-${craft.id}`);
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
            {here.crafts.length} craft{here.crafts.length === 1 ? '' : 's'}
          </div>
          {here.crafts.length > 0 && (
            <ul className="country-list">
              {here.crafts.map((c) => (
                <li key={c.id}>
                  <button onMouseEnter={() => focusCraft(c)} onMouseLeave={scheduleHide} onClick={() => (c.route ? navigate(c.route) : focusCraft(c))}>
                    {c.image ? <img src={c.image.src} alt="" /> : <span className="country-noimg" aria-hidden="true" />}
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
          {!here.crafts.length && (
            <p className="country-empty">No crafts mapped in {here.name} yet.</p>
          )}
        </aside>
      )}

      <div ref={leaderRef} className="globe-leader" style={{ display: hover ? 'block' : 'none' }} />
      <div ref={cardRef} className="globe-card" style={{ display: hover ? 'block' : 'none' }} onPointerEnter={() => clearTimeout(hideTimer.current)} onPointerLeave={scheduleHide}>
        {hover && (
          <div key={hover.id} className="gc-inner">
            {hover.kind === 'craft' && <CraftCard craft={hover.craft} />}
            {hover.kind === 'cluster' && <ClusterCard pin={hover} onLand={() => landIn(hover.country)} />}
          </div>
        )}
      </div>
    </div>
  );
}
