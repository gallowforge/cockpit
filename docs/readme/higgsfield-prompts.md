# Higgsfield prompt (optional, not generated)

Nothing has been generated and no credits were spent. The README images are finished without it: the sky and the ground are CSS gradients in `docs/readme/src/base.css` (`.frame` and `.ground`), and every screen is a real capture of `cockpit demo`.

One plate would gain from a real image: the night itself, behind the hero and the social preview.

## 1. Night horizon plate (hero and social background)

**One idea.** The real view from a flight deck on a night crossing: the curve of the earth with its thin blue airglow, deep night above, and a dark desert below with a few warm town lights, so the README's horizon line sits on a real night instead of a gradient.

**Model.** Seedream 5.0 Pro, Ali's standing choice for stills. It renders night skies and city lights from altitude cleanly, without the plastic look. One image, 2:1 (it is cropped to 1280×640 for the social preview and to 1100×600 for the hero), highest resolution offered. One generation.

**Use.** A background image under `.frame` in `hero.html` and `social.html` only, at about 70% opacity under the existing gradient. The bright horizon line, the screen, the type and the lamps stay in code. The horizon in the photo must be level and sit at 76% to 86% of the height, so the CSS line lands on it.

**Prompt.**

> Photograph from the flight deck of an airliner at cruise altitude on a clear moonless night, looking straight ahead over a dark desert. The horizon is perfectly level and sits low in the frame, about four fifths of the way down. Above it, a deep night sky going from near black at the top to a dark navy blue near the horizon, with a thin, soft band of blue airglow hugging the curve of the earth. A few faint stars high in the sky. Below the horizon, the desert is almost black, with three or four small, scattered clusters of warm amber town lights far away and one thin road of lights. Calm, still, quiet, vast. Natural long-exposure night photography, fine grain, no noise.

**Slots.**
- Subject: the night horizon from altitude, nothing in front of it.
- Composition: level horizon at about 80% of the height, wide, empty centre.
- Light: moonless, airglow only; the brightest thing is the horizon band.
- Colour: sky `#010307` to `#12304a`, ground near `#090705`, town lights amber around `#ffad4a`, used sparingly.
- Camera: wide lens, no window frame, no reflections.

**Negative.** No aircraft parts, no windscreen frame, no instruments, no wing, no glare or reflections on glass, no moon, no clouds, no aurora, no Milky Way, no city sprawl, no bright lights near the centre, no lens flare, no text, no letters, no logos, no people, no tilt, no fisheye curve, no purple, no teal, no orange sky, no 3D render look.

**Acceptance check.** The horizon is level within 0.5° and lands under the CSS line at 76% to 86% height; the sky samples stay within about 10% of the gradient it replaces; the headline, the gauges and the screen stay legible on top of it at 100% and as a 500 px thumbnail; nothing in the photo competes with the amber line or the lamps.
