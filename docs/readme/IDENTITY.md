# Vesper: the look

**An operations console, built to be trusted.** Vesper answers one question, "does anything need me?", so the design is plain on purpose: one sentence first, the facts behind it, then the detail. It is measured against the tools people rely on every day (Linear, Vercel, Raycast), not against a poster.

**Haze.** The look takes its air from the film *Vesper* (Kristina Buožytė and Bruno Samper, 2022): a forest after the collapse, fog between the trees, a sickly ochre light hanging in it, and the cyan glow of living technology. The console keeps that air behind the data and nowhere else. The ground is a deep green-black (`#060d0a`), surfaces are moss in shadow (`#0e1914`, `#13211a`), hairlines are moss (`#15231c`, `#203229`) and the text is fog (`#e4eee6`, `#a9bcae`, `#8fa395`).

**How the haze is built.** CSS only, two fixed layers behind the page: ochre light from above, a cyan glow at the right edge and low on the left, moss fog on the floor, and a fine organic grain (an SVG noise tile). A second layer holds a few faint fog banks that drift over ninety seconds; with reduced motion they stand still, and screenshots (`?shot`) freeze them. On top of that, a haze band sits behind the panels that matter: the key figures are one instrument panel, the Overview status has a soft glow of its own state behind it, and the sidebar, the rail and the dialogs are moss glass. Nothing animates but the fog, the live dot and a service that is down now.

**Colour still only means state.** Green (`#58de86`) is up, marigold (`#f7ab3e`) needs you, coral red (`#ff6a5c`) is down, and hatched sage means Vesper cannot see. A down mark that is over turns a quieter red, so only what is down now is loud. Every state also has a shape and a word, never colour alone, and the day lines say it twice: up sits low, degraded rises, down stands full height, so an outage reads without colour. A failed run carries the same bar cut as the down mark. The two colours that are not states keep to their own jobs: cyan (`#5fe1ea`) is live or something you can press (the live dot, focus rings, the active page, the primary button, links), and the ochre haze is never a mark at all, so "needs you" never melts into the light.

**Contrast.** Every text colour keeps at least 4.5:1 and every status mark at least 3:1 against the ground, the raised surfaces and the brightest haze; text was also measured against the rendered page, grain included.

**Honest by construction.** The day line marks time Vesper did not watch as unknown, uptime is counted only over what it saw, and a check it cannot make is a blind spot, never an all-clear. The design shows these states as plainly as the good ones.

**Type.** IBM Plex Sans for words and IBM Plex Mono for every figure, both vendored with their licences, so the console needs nothing from the internet. Numbers are tabular so columns line up.

**Layout.** On a desktop: a sidebar, the main column (status, the 24-hour strip, four figures, the services table) and a rail (since you last looked, backups, the next jobs, the host, what Vesper can see). On a phone: one column and a tab bar with a More tab. Titles and their lines wrap instead of hiding what they say. Every page is checked at phone width for overflow.

**The mark.** A V in fog white under the evening star, the first light of the night, glowing cyan like the living things in the haze. App icons are rendered from `docs/brand/app-icon.html`.

**The README.** The screens are the real UI of `vesper demo` on synthetic data and a frozen clock, staged as glass windows in the same family as the author's GitHub profile, dark and light, each with a phone layout. In the hero the status lifted out of the Overview turns from "Nothing needs you" to "Home Assistant is down" and back: the one motion, and the product's whole idea. The README images still show the graphite look until they are captured again.

**Rebuild.** `scripts/readme-visuals.sh` (see its header). Sources: `docs/readme/src/textures.mjs` (captures and typeset windows), `docs/readme/src/layouts.js` (compositions), `docs/readme/src/glass/` (the renderer: three.js in headless Chromium). The detail for a careful viewer is in the demo data: among the real homelab jobs, "Remind the humans to descale the kettle", Saturdays at 09:00.
