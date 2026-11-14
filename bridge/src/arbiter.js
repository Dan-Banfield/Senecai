// Picks one glove source to forward when Studio and the SDK both stream, since
// their coordinate conventions differ and interleaving makes the wrist jump.
//
// Only frames that carry hand data can claim the feed: the first source to send
// hands becomes active, and another only takes over once the active one has sent
// no hands for `timeoutMs`. So a Studio stream without gloves (actors only) can't
// starve a working SDK stream.
//
// Hand-less frames are still forwarded when they can't disturb anything: from the
// active source (the browser then sees its hands disappear), or, while no source
// has hands at all, from one "idle" source picked the same way, so the browser can
// still show the actor list.

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const PHALANGES = ['Proximal', 'Medial', 'Distal'];

/**
 * True when some actor carries a usable hand, by the same rules the web app's
 * parser uses: a `<side>Hand` joint plus every finger's proximal/medial/distal
 * joints, and the actor's per-side glove flag not explicitly false.
 * @param {any} frame Rokoko Studio JSON v3 frame.
 */
export function hasHandData(frame) {
  const actors = frame?.scene?.actors;
  if (!Array.isArray(actors)) return false;
  return actors.some((actor) => {
    const body = actor?.body;
    if (!body || typeof body !== 'object') return false;
    return ['left', 'right'].some((side) => {
      const flag = side === 'left' ? actor.meta?.hasLeftGlove : actor.meta?.hasRightGlove;
      if (flag === false || !body[`${side}Hand`]) return false;
      return FINGERS.every((f) => PHALANGES.every((p) => body[`${side}${f}${p}`]));
    });
  });
}

/**
 * @param {{timeoutMs?: number, now?: () => number, onSwitch?: (to: string, from: string | null) => void}} [opts]
 */
export function createArbiter({ timeoutMs = 500, now = Date.now, onSwitch } = {}) {
  /** Last frame with hands, per source. @type {Record<string, number>} */
  const lastHands = {};
  /** Last frame of any kind, per source. @type {Record<string, number>} */
  const lastSeen = {};
  /** Source whose hands are forwarded. @type {string | null} */
  let active = null;
  /** Source whose hand-less frames are forwarded while nobody has hands. @type {string | null} */
  let idle = null;

  const live = (source, times, t) => source !== null && t - times[source] <= timeoutMs;

  return {
    /** The source that last claimed the feed with hand data (may have gone quiet since). */
    get active() {
      return active;
    },
    /**
     * Records a frame from `source`; returns true if it should be forwarded.
     * @param {string} source
     * @param {boolean} [hasHands] whether the frame carries hand data (see hasHandData)
     */
    offer(source, hasHands = true) {
      const t = now();
      lastSeen[source] = t;
      if (hasHands) {
        lastHands[source] = t;
        if (source === active) return true;
        if (live(active, lastHands, t)) return false;
        const from = active;
        active = source;
        onSwitch?.(source, from);
        return true;
      }
      // Hand-less frames never refresh a source's claim on the feed.
      if (live(active, lastHands, t)) return source === active;
      if (source === idle) return true;
      if (live(idle, lastSeen, t)) return false;
      idle = source;
      return true;
    },
  };
}
