# Asset Decisions — v24

## Selected core hardware

### Pioneer CDJ 3000 + DJM A9
- ~29k triangles
- ~3.0 MB GLB
- Separate semantic scene objects for left deck, mixer and right deck
- Best option for hand targets and web performance

### Glass computer desk
- Main desk geometry ~2.24 m wide × 0.76 m tall × 0.80 m deep before runtime scaling
- Very lightweight
- Giant decorative `Floor` node is removed before bounds/placement calculations

## Selected atmosphere

### Play neon
- Flat emissive prop, used behind the booth

### Neon boombox
- ~5.7k triangles / ~1 MB
- Used as a compact dystopian prop

## Selected wearable

### headphone.fbx
- ~2 MB
- 25 mesh geometries, 8 materials
- Much more reasonable than the old 19 MB headphone GLB

## Rejected from runtime

### Pioneer DJ Console
Good quality but ~15.9 MB and only two primary meshes. Kept out because the smaller CDJ/DJM model gives better semantic DJ targets.

### flex_dj
~72k triangles but 647 meshes: draw-call heavy.

### Splatoon 3 DJ booth
Light enough geometrically, but franchise-derived and 48 materials. Not appropriate as the public-site foundation.

### Headphone neon sign
~110k triangles for background decoration.

### Neon party glasses
~31 MB as uploaded; too heavy for a face prop.
