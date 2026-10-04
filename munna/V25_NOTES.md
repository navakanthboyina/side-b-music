# v25 implementation notes

## Grounding

The old runtime recalculated a skinned-shoe bounding box and hard-corrected Y every frame. That prevented some penetration but could create visible vertical hopping. v25 calibrates bone-to-sole offsets from the foot/toe bones, then applies bounded damped contact corrections. Dance is different: no downward grounding is applied, so authored jumps remain intact; only downward floor penetration is corrected.

## Booth

The glass desk contains an oversized floor plane which is removed before any measurements. The remaining desk is scaled to a wide DJ shape relative to Munna rather than using its original model aspect blindly. Pioneer hardware stays uniformly scaled to protect its geometry and is placed on the tabletop.

## Accessories

The headphone FBX contains a huge stray plane among the headphone pieces. It is automatically detected as an outlier and removed. Headphones are then sized from head width. Sunglasses use the original avatar glasses as the face landmark.

## Interaction

User input is intentionally layered:
- pointer movement -> gaze/head/very small torso tracking
- card hover/search/rating -> event-specific reactions
- avatar touch -> region-specific reaction family
- playback -> DJ actions + occasional performance accents
- dance -> only state allowed to leave booth
