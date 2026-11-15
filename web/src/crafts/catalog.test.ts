import { describe, expect, it } from 'vitest';
import { CRAFTS } from './catalog';

describe('craft catalog', () => {
  it('has unique ids', () => {
    const seen = new Set<string>();
    for (const c of CRAFTS) {
      expect(seen.has(c.id), c.id).toBe(false);
      seen.add(c.id);
    }
  });

  it('gives every craft a blurb', () => {
    for (const c of CRAFTS) expect(c.blurb.length, c.id).toBeGreaterThan(40);
  });

  it('only playable crafts have routes', () => {
    for (const c of CRAFTS) expect(!!c.route, c.id).toBe(c.status === 'playable');
  });

  it('photos are local files or Wikimedia links', () => {
    for (const c of CRAFTS) if (c.image) expect(c.image.src, c.id).toMatch(/^(\/crafts\/|https:\/\/[a-z]+\.wikimedia\.org\/)/);
  });
});
