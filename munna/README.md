# Munna’s Grooves — Dystopian Playground v26

Local integration build focused on physical grounding, booth proportions, richer user reactions, accessory calibration, and preview-player behavior.

## What changed from v24

- Wide/low DJ booth sizing derived from Munna’s measured height.
- Glass desk floor-junk removed; desk scaled independently in X/Y/Z.
- Pioneer CDJ/DJM hardware centered on the physical tabletop.
- Added shallow dark booth fascia + low-cost cyan LED slot.
- Main WebGL renderer now sizes from the actual stage canvas, not the whole dock chrome.
- Foot/toe contact solver uses LeftFoot / LeftToeBase / RightFoot / RightToeBase and smooths Y corrections.
- Walking and standing share the same Y=0 physical ground plane.
- Dance preserves authored jumps but is corrected immediately if shoes penetrate the floor.
- Preview Munna uses the same foot-contact strategy and no longer performs per-frame hard Y snaps.
- Preview intro faces the user, greets, then turns to walk; close faces the user, says bye, waves, then disappears.
- Global desktop cursor drives Munna’s eyes, head and a small torso follow.
- Touch regions now distinguish head, glasses, headphones, arm, torso and legs.
- Added nine more curated motion clips for more dance / celebration / gesture variation.
- Comic dialogue follows Munna’s head instead of living in a fixed panel corner.
- Headphone FBX outlier plane is automatically removed before fit calibration.
- Sunglasses stay calibrated against Munna’s original fitted glasses.

## Run

```bash
python3 -m http.server 5173
```

Open http://localhost:5173

Or double-click `RUN_LOCAL_V26.command` on macOS.

## Test order

1. Relaxed/listening: feet should stay on the same stage floor.
2. Dance out / return: walking should remain grounded and camera should follow.
3. Preview player: hello facing user -> walk -> turn -> walk -> bye facing user -> disappear.
4. Move the desktop cursor across the page; Munna should track it naturally.
5. Touch head / glasses / headphones / arms / torso / legs and compare reactions.
6. Start a preview and watch real Pioneer DJ target actions plus occasional performance accents.
7. Inspect headphone and sunglass fit while the head moves.
8. Resize to mobile width and verify booth proportions remain correct.


## v26 key changes
- Fixed-plane locomotion and preview walking; no per-frame Y chasing.
- Constant precomputed safe Y per dance clip.
- Glass table flipped independently from Pioneer hardware.
- Wider/lower booth proportions.
- Removed the custom cyan front strip.
- Larger centered PLAY neon behind DJ.
- Boombox faces audience.
- Smaller comic dialogue typography.


## v29 focused refinements
- DJ desk/console scaled down so Munna reads at a more natural size.
- Neon boombox rotated to the opposite audience-facing direction.
- Main Munna rail is wider at the top of the page and compacts to a right-aligned sticky stage after scrolling.
- Comic bubble sits higher above Munna with smaller text.
- Dance stage Y is lowered by only 1 cm; walking/standing grounding from v27 is unchanged.
