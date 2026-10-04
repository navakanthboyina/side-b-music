# v26 refinement notes

## Physical fixes
- Main walking uses a single calibrated root Y for the entire locomotion cycle. No per-frame vertical foot chase.
- Mini Munna uses a single calibrated walk root Y derived from the real `Walking With A Swagger` clip.
- Every preloaded full-body dance gets one constant safe root height sampled before runtime. This prevents below-floor penetration without adding frame-to-frame vertical hops.
- The glass desk is rotated 180° on Y independently from the Pioneer hardware, so the table faces the opposite direction while the decks continue facing the audience.

## Booth composition
- Booth width increased from ~1.12× avatar height to ~1.38×.
- Booth height reduced from ~0.46× to ~0.40× avatar height.
- Pioneer hardware fills ~92% of the desk width.
- Removed the custom cyan emissive line from the table fascia.
- PLAY neon enlarged, centered behind the DJ, and given soft magenta/cyan spill lights.
- Neon boombox quarter-turned toward the audience.
- Desktop character rail widened to 450px; intermediate desktop width uses 370px.

## Dialogue / player
- Comic dialogue font reduced in size and maximum bubble width reduced.
- Preview walker is slightly larger but moves more slowly.
- Player footprint remains the existing ~850px desktop treatment and responsive mobile layout.
