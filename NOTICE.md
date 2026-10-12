# Sources and notices

- Viewer and 4D controls based on [dearsip/CRF-Polychoron-Viewer](https://github.com/dearsip/CRF-Polychoron-Viewer), revision `c473373b94e43b28b592b00d099fb4dee71f6adc`. Its CC0 1.0 license is retained in `LICENSE`.
- Three.js 0.184.0 is vendored in `vendor/three`; its MIT license and exact file hashes are included there.
- Surface geometry, original cells, colors and convex-hull/pocket CSG data are exported from HachigayoLab's Regular Star Polytopes Gallery Unity project. Shape references are recorded individually in `data/catalog.json` and each model's JSON; they link to the Polytope Wiki. These citations are references, not a new license declaration for external data.
- The renderer uses the adopted per-shape constant geometry, root folding, and reduced/merged operation bodies generated into `data/*.pocket.glsl`. Fix uses three large-subface clipping tests from `FixOcclusion.cginc`, prepared at vertices. The complete hull-pocket sector routing is retained for the other shapes; no exterior/subface BVH is used.
- `src/pocket-glsl.js` is the generic complete-solid predicate retained as a verification reference. It is not a rendering fallback. The generated optimized sources and `src/fix-glsl.js` derive from the corresponding HachigayoLab shader includes.
- `tools/fixtures/pocket-probes.json` contains a deterministic subset of the Unity project's existing ray-validation records, including positive and negative viewing angles. It is used only by the optional browser verification tool, not loaded by the website.
- `tools/fixtures/folding-segments.json` covers symmetry chamber walls and crossing segments, with independently computed solid-intersection results.
- The four polyhedra use ray intersection with the union of origin-to-filled-face convex blocks. The third source coordinate is embedded in W, leaving Z fixed for the 3D-to-2D projection.

The retained upstream mesh utilities and sample meshes remain available for reference. The website loads only its own `data/` assets.
