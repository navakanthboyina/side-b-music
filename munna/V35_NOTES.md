# v35 — preview foot-bone floor fix

- Based on your exact local v34.
- Replaces whole-model bounding-box preview calibration with LeftFoot/RightFoot/LeftToeBase/RightToeBase calibration.
- Shoe-sole offset is measured once in rest pose.
- 80 walk samples determine the lowest animated sole point.
- Preview Y is then fixed for the entire walk; movement remains X-only.
- Dedicated preview stage bottom equals the whole player-card top edge.
- DJ booth is untouched in this pass.
