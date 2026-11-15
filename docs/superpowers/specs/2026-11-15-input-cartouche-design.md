# Input control: pill to map cartouche

## Intent
The header input pill (`SourcePill`) reads as a generic, "vibecoded" capsule. The
home/craft pages are styled as a parchment atlas plate, so the control should look
like part of the map: a legend cartouche.

## Goals
- Rectangular cartouche (2px radius, thin double rule, same recipe as the
  `.globe-page::after` plate frame) instead of a 999px capsule.
- Two lines: tracked small caption `INPUT` (muted), source name in Cormorant
  italic ~17px; *Choose input* when no source.
- Status as a map symbol, no glow: filled forest diamond = live, hollow ochre =
  waiting/starting, red with a slash = error, hollow muted = off.
- `L` and `R` always shown: ink when tracked, faded when not (no width jump).
- Hover darkens the rule and warms the paper slightly.
- Search input adopts the same rectangle + double rule.
- Under 640px: caption hidden, single line.

## Non-goals
- `.btn` buttons elsewhere, the input drawer, click/tooltip behaviour.

## Approaches
1. **Map cartouche (picked).** Matches the atlas plate the header sits on.
2. Instrument readout (mono, LCD-ish): fights the parchment look.
3. Keep the capsule, tweak colors: doesn't fix the shape complaint.

Direction was the builder's call at the user's request.
