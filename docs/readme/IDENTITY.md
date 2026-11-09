# Cockpit: the identity

**The one idea.** Night flight. The house is an aircraft on a long night crossing, and Cockpit is its artificial horizon: level and blue while nothing needs you, banked amber or red the moment something does. You glance, you know, you go back to sleep.

**Motif.** The attitude indicator and nothing else from the flight deck. A night-blue sky above, a dark ground below and one bright horizon line between them. The line tilts (2.6° for a caution, 5° for a warning) and changes colour; everything else stays still. Under it, a strip of eight lamps that stay dark until they are needed, and thin head-up-display gauges for the host. No screws, plates, bezels or brushed metal: the idea is carried by one line of light.

**Signature visual.** The Overview with one caution: the horizon banked amber behind the four gauges, only the Config drift lamp lit, and a line that says what happened in the 3 hours since you last looked. One hand-drawn amber note: "the horizon banks amber, one cell lights, and everything else stays dark".

**Type.** Two families, both from aviation signage and displays:
- **Barlow Condensed** for headlines, numbers and lamp legends. It reads like the labels on a modern glass cockpit: tall, narrow, legible at a glance.
- **Barlow** for everything else. The same skeleton, so the page has one voice.

IBM Plex Mono appears only where the README shows real terminal output.

**Palette** (60 / 30 / 10):

| Role | Colour | Hex |
|---|---|---|
| Field, 60 | night | `#04070b` (panels `#0a0f15`, raised `#141c26`) |
| Support, 30 | sky and horizon glow | `#0a1a2a` to `#12304a`, line `#d6ecff` |
| Accent, 10 | amber, for a caution only | `#ffad4a` |
| Meaning only | red for a warning, green for proof | `#ff5f5f`, `#49e3a0` |

Amber is spent only when something needs you. Green is spent only on facts that were checked (verified sets, passed drills, PASS lines, the SAFE score).

**Voice.** Calm under pressure, like a good first officer. "All systems normal. Level flight. Nothing needs you." Short, plain, never alarmed; a problem is named, ranked and handed over with its checklist.

**Signature interaction.** The lamp test. Press TEST on the strip and all eight lamps light for a moment, as pilots check theirs before take-off, then settle back to the truth.

**Rules.** Screens are real `cockpit demo` captures on a frozen clock, staged on the horizon: the line sits under the screen, the screen casts its shadow on the ground. Footnotes sit on the ground below the line. Each image keeps one detail for a careful viewer: `kettle-descale.timer` ("Remind the humans to descale the kettle") among the real homelab timers, the lamp test, and the app icon, which is the horizon itself.
