# v36 — exact preview top-border floor lock

- Based on your exact local v35.
- The whole preview player's top border is the floor.
- Lowest foot/toe sole is projected into the orthographic Mini camera every frame.
- Mini root Y is corrected so that sole lands at canvas bottom (3 px clearance).
- Since the stage uses bottom:100%, canvas bottom equals player top border exactly.
- No guessed world Y, no full-body bounds, no sampled safe-height heuristic.
- HELLO: face user -> greeting -> turn sideways -> walk.
- BYE: stop -> face user -> wave -> disappear.
- DJ booth untouched.
