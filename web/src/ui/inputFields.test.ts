import { describe, expect, it } from 'vitest';
import { SOURCE_INFO, sourceFields } from './inputFields';
import type { SourceKind } from '../input/types';

describe('sourceFields', () => {
  it('shows only the settings each source uses', () => {
    expect(sourceFields(null)).toEqual([]);
    expect(sourceFields('webcam')).toEqual(['camera', 'swapHands']);
    expect(sourceFields('gloves')).toEqual(['bridgeUrl']);
    expect(sourceFields('keyboard')).toEqual([]);
  });

  it('keeps every row blurb to one short line', () => {
    for (const k of Object.keys(SOURCE_INFO) as SourceKind[]) expect(SOURCE_INFO[k].blurb.length).toBeLessThanOrEqual(60);
  });
});
