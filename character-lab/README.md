# Munna's Grooves — Character Lab

This directory is an isolated production testbed for the next-generation character system. It does **not** change the live Munna's Grooves application or shared backend.

## Purpose

Validate character quality before integration:

- Munna seated at a real DJ booth with authored body clips, facial morph targets and gaze bones.
- Preview Munna reuses the same rig and travels along the preview tile as a forward/3-quarter listening walk — never a side-profile sprite walk.
- Music-note / pulse particles originate from named earbud sockets.
- Shadow Girl and Shadow Boy use rigged GLB models, AnimationMixer blending, a finite-state behavior controller and navigable surfaces.
- Music influences energy, particles and DJ behavior but does not determine whether the runners exist or move.

## Required model contract

Place production assets under `public/models/`.

### `munna.glb`

Required object/socket names:

- `Eye_L`
- `Eye_R`
- `Earbud_L`
- `Earbud_R`

Expected animation clips:

- `DJ_Idle`
- `DJ_Listening`
- `DJ_AdjustKnob`
- `DJ_Scratch`
- `DJ_CueHeadphones`
- `React_Like`
- `React_Dislike`
- `React_User`
- `React_Runner`
- `React_Complete`
- `WalkListening`

Recommended facial morph targets:

- `blinkLeft`
- `blinkRight`
- `browUpLeft`
- `browUpRight`
- `browDownLeft`
- `browDownRight`
- `smile`
- `smirk`
- `mouthOpen`
- `mouthPucker`
- `cheekRaise`
- `surprise`
- `squint`

### Shadow models

Planned files:

- `shadow-girl.glb`
- `shadow-boy.glb`

Expected body clips: `Idle`, `Run`, `Turn`, `JumpAnticipation`, `Jump`, `Land`, `Peek`, `Hide`, `LookBack`.

## Runtime order

The lab intentionally uses a deterministic frame pipeline:

1. input
2. behavior
3. physics
4. animation
5. audio
6. camera
7. render

This prevents DOM interaction, physics, animation blending and rendering from racing each other.

## Local development

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
```

## Integration rule

Do not merge this lab into the live site until the character behavior passes visual review. The current `shared-app.mjs`, `preview-player.mjs`, recommendation logic and Cloudflare backend remain the source of truth.
