# Vesper: the look

**An operations console, built to be trusted.** Vesper answers one question, "does anything need me?", so the design is plain on purpose: one sentence first, the facts behind it, then the detail. It is measured against the tools people rely on every day (Linear, Vercel, Raycast), not against a poster.

**Colour only means state.** The field is graphite with hairlines instead of boxes. Green is up, amber needs you, red is down, and a hatched grey means Vesper cannot see. A down mark that is over turns a quieter red, so only what is down now is loud. Nothing is coloured for decoration, and every state also has a shape and a word, never colour alone.

**Honest by construction.** The day line marks time Vesper did not watch as unknown, uptime is counted only over what it saw, and a check it cannot make is a blind spot, never an all-clear. The design shows these states as plainly as the good ones.

**Type.** IBM Plex Sans for words and IBM Plex Mono for every figure, both vendored with their licences, so the console needs nothing from the internet. Numbers are tabular so columns line up.

**Layout.** On a desktop: a sidebar, the main column (status, the 24-hour strip, four figures, the services table) and a rail (since you last looked, backups, the next jobs, the host, what Vesper can see). On a phone: one column and a tab bar with a More tab. Every page is checked at phone width for overflow.

**The README.** The screens are the real UI of `vesper demo` on synthetic data and a frozen clock, staged as glass windows in the same family as the author's GitHub profile, dark and light, each with a phone layout. In the hero the status lifted out of the Overview turns from "Nothing needs you" to "Home Assistant is down" and back: the one motion, and the product's whole idea.

**Rebuild.** `scripts/readme-visuals.sh` (see its header). Sources: `docs/readme/src/textures.mjs` (captures and typeset windows), `docs/readme/src/layouts.js` (compositions), `docs/readme/src/glass/` (the renderer: three.js in headless Chromium). The detail for a careful viewer is in the demo data: among the real homelab jobs, "Remind the humans to descale the kettle", Saturdays at 09:00.
