# v27 focused corrections

- Removed the Live Signal card; its reactive canvas now lives as a subtle full-page ambient background.
- Wider right-side DJ stage and wider Pioneer/glass desk setup.
- Removed animation-derived root-height sampling. Root Y is calibrated once from the original standing avatar only.
- Root translation on Hips/AvatarRoot is stripped on X, Y, and Z for all retargeted clips. Locomotion moves only X/Z in code.
- Main and Mini Munna keep a constant root Y during walking and dancing; no per-frame vertical chase.
- Mini baseline is independently calibrated from the original avatar shoe sole.
