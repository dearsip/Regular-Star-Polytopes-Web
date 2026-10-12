# Local validation

Verified 2026-10-12 with installed Chrome, Playwright and WebGL 2 / ANGLE SwiftShader on Windows. Hardware GPU and mobile device performance have not been measured.

- Data validation: all 14 models; STG1 headers and lengths, every vertex's finite coordinates, every index and unit ID, region and group bounds, decompressed SHA-256 hashes, and vendored Three.js hashes passed.
- Browser smoke: all 14 Full modes at FoV 0°, +60°, −60° compiled and rendered. GPU geometries/textures remained bounded across model switches. Screenshots contained the projected objects.
- All five display modes for Fix and Great Dodecahedron passed, including Explosion at its maximum. Parallel/cross-eyed stereo, 3D drag with fixed Z, pose/FoV URL round trip, and mobile viewport/panel behavior passed. No page errors or shader errors were reported.
- Occlusion: 128 rays per polychoron, 1,280 total, including positive and negative FoV. WebGL results matched every existing reference result, and the prepared vertex-frame path matched the direct entry path.
- Visual controls: disabling occlusion changed 33,858 pixels in the test crop; Depth filter at +89° removed the object completely.
- Built `dist/` worked at `/Regular-Star-Polytopes-Web/`, matching GitHub Pages project-site hosting. Final linear-to-sRGB output compiled and rendered for both shader families.
- GitHub deployment has been prepared but not executed; the destination repository has not been provided. The upstream Git history is retained and its remote is named `upstream`; main has no upstream tracking branch.

The optional verification tools write screenshots and detailed JSON reports into ignored `test-artifacts/`. See the README for running them. The included preview shows the final color-space output.

## Input and stereo update

- Polychoron left drag now accounts for the renderer's reversed Z convention. Screen-space near points follow all four drag directions. Right drag and polyhedron left drag retain their directions and pass the same checks: 12 end-to-end pointer cases, including the polyhedron's Z lock.
- Eye spacing appears only for parallel/cross-eyed stereo, adjusts the camera separation from 0 to 1 (default 0.25), retains its value when stereo is turned off, and round-trips through the view URL.
- Browser checks passed without shader/page errors. Changing spacing from 0 to 0.8 visibly changed the rendered stereo image. Detailed results are in `test-artifacts/browser-input.json`.

## Optimized renderer and view URL regression

- All ten polychora now use the adopted source fast variants: direct three-subface clips for Fix; constant planes and one-void/one-spike cases; symmetry-folded roots; reduced operation bodies for Gahi/Gaghi/Gofix/Gax; merged operations for Gohi. Baked unit-entry IDs avoid the vertex seed lookup. Source material selections determine whether entry-frame preparation belongs at vertices or fragments.
- All 1,280 signed-FoV ray results matched the independent reference and generic predicate. Another 2,048 chamber-wall/crossing segments matched the independent solid oracle. Four of those boundary segments differed from the generic float32 predicate; the optimized results matched the oracle in each case.
- The final browser smoke test passed all 14 Full modes at 0°, +60°, and −60°, both shader families' display modes, stereo, controls, sharing, and the mobile layout.
- Completed-render comparison at 160×160, after warmup, including synchronous readback, showed 1.31–3.43× improvement in Chrome/ANGLE SwiftShader. This is a software-rendering comparison, not a hardware GPU frame-rate guarantee. Foreground masks differed by one boundary pixel for Fix and Gishi and matched exactly for the other eight shapes; there were no interior-mask differences.
- Gashi's folded and static-plane variants were both compared; the folded variant was faster in the isolated final comparison and remains selected.
- Partial modes use selected index ranges. Fix: 57,600 Full triangles → 1,440 vertex-neighborhood / 21,240 radial / 120 single-cell triangles. Gahi: 1,152,000 → 6,720 / 335,160 / 120. Gax: 2,188,800 → 9,600 / 1,383,000 / 24. Radial culling uses a conservative sphere/halfspace bound, and exact boundary selection remains in the fragment shader. The full solid still occludes selected pieces.
- Removed the unused dummy XYZ attribute, saving 12 bytes per vertex on both CPU and GPU (about 26 MB each for Gax).
- Reproduced the excessive enlargement on a direct stereo URL: the source camera's world matrix was still at the origin when stereo eyes were constructed. Updating that matrix before StereoCamera fixes it. Parallel and cross-eyed snapshots matched pixel-for-pixel before/after URL restoration, and changing Zoom visibly changed the image. Shared pose and velocity values retain full precision.

Detailed local reports: `browser-optimized.json`, `browser-folding.json`, `browser-performance.json`, `browser-view-url.json` in ignored `test-artifacts/`. Reproducible tools are in `tools/`.

## Explosion radius and Arcball regression

- Corrected Explosion normalization to `sqrt(1 + |cellCenter|² * e * (e + 2))`, matching the original shader. The underlying unmargined vertex radius stays one; display margins remain unchanged. Moved-cell support thresholds now follow the same normalization for facing tests, and Depth filter uses the final cell center.
- `tools/browser-behavior.mjs` captures the actual vertex shader outputs through WebGL 2 transform feedback for every original-mesh vertex of all 14 models. At Explosion 0%, 50%, and 100%, FoV 0°/+60°/−60°, and two depth thresholds, positions match the independent source formula within 3e-6, underlying corner radii stay one, and every facing/depth decision matches. The displayed meshes' outer radii range from 0.941 to 0.980 initially and from 0.978 to 0.994 at maximum Explosion, rather than collapsing toward the center.
- Inverted the Arcball position-dependent tilt to use the projected near hemisphere. Forty pointer-input cases cover left/right buttons, both dimensions, horizontal/vertical drags, and five offsets from the canvas center. The tilted direction is tangent to the near hemisphere at the pointer; the polyhedron's unused Z axis remains fixed.
- Arcball defaults off in the controls and page. Explicit `arcball=1` URLs still enable it; both on/off values survive sharing and reloading. The existing twelve screen-direction and stereo-spacing regressions still pass.

Detailed local report: `test-artifacts/browser-behavior.json`. These checks use installed Chrome with ANGLE/SwiftShader; no additional browser or scientific package installation is needed.
