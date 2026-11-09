# Cockpit: the README's look

**Night flight, in glass.** The README belongs to the same family as the author's GitHub profile: real screens as frosted-glass windows floating in light, with depth, refraction and one part of each screen lifted out toward the viewer. Cockpit's own idea stays at the centre: the house is an aircraft on a night crossing, and the dashboard is its artificial horizon, level and blue while nothing needs you, banked amber or red when something does.

**Real screens.** Every window is the real UI of `cockpit demo` on synthetic data and a frozen clock, captured at 2x (desktop) and 3x (phone). The terminals are a fresh `cockpit check` and the end-to-end run in `docs/readme/src/demo/e2e.txt`; the diagram and the numbers are typeset from the README's own facts.

**The horizon.** Behind the glass, one horizon line runs through a night-blue sky. In the hero it banks amber for a few seconds while the lifted horizon card and the phone turn from "All systems normal" to "1 caution", then everything levels again: the one motion in the README, and the product's whole idea.

**Dark first.** Cockpit has one theme, night. The dark images dissolve into GitHub's `#0d1117`; the light images keep Cockpit's dark screens as dark windows on bright daylight glass, dissolving into `#ffffff`, while the terminals and the diagram switch to their light theme. Amber is spent only on a caution, red only on a warning, green only on checks that passed.

**Type.** The screens keep Barlow and Barlow Condensed, Cockpit's own. Everything typeset around them uses Geist and Geist Mono, the family's faces.

**Rebuild.** `scripts/readme-visuals.sh` (see its header). Sources: `docs/readme/src/textures.mjs` (captures and typeset windows), `docs/readme/src/layouts.js` (compositions), `docs/readme/src/glass/` (the renderer: three.js in headless Chromium). The detail for a careful viewer is still there: `kettle-descale.timer`, "Remind the humans to descale the kettle", among the real homelab timers on the Timers page.
