# Hellforge scene BGM

| File | Phase | Notes |
|------|--------|--------|
| `bgm-camp.mp3` | `camp` (+ title / char UI / wild) | Filename in tree; **provenance uncleared** |
| `bgm-den.mp3` | `den` | Filename in tree; **provenance uncleared** |

Playback contract lives in `src/bgm.ts` (HTMLAudio + crossfade). SFX stays in
`src/sfx.ts` (synth).

## Provenance / Milestone 5.3–5.4

These files were previously labelled with Metaphor OST-style titles
(“Desecrated Cathedral”, “Priestess of the Temple”). That labelling is **not**
a cleared license. Until a rights-cleared replacement (or documented license)
lands:

- Do **not** claim audio verifier / provenance gates pass.
- Do **not** invent license text.
- Prefer replacing with originally authored or clearly licensed tracks before
  shipping a public build.
