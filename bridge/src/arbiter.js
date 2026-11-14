// Picks one glove source to forward when Studio and the SDK both stream, since
// their coordinate conventions differ and interleaving makes the wrist jump.
// The first source to send becomes active; another only takes over once the
// active one has been silent for `timeoutMs`.

/**
 * @param {{timeoutMs?: number, now?: () => number, onSwitch?: (to: string, from: string | null) => void}} [opts]
 */
export function createArbiter({ timeoutMs = 500, now = Date.now, onSwitch } = {}) {
  /** @type {Record<string, number>} */
  const last = {};
  /** @type {string | null} */
  let active = null;

  return {
    get active() {
      return active;
    },
    /** Records a frame from `source`; returns true if it should be forwarded. */
    offer(source) {
      const t = now();
      last[source] = t;
      if (source === active) return true;
      if (active !== null && t - last[active] <= timeoutMs) return false;
      const from = active;
      active = source;
      onSwitch?.(source, from);
      return true;
    },
  };
}
