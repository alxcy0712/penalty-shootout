# Conservative image clarity — 2026-10-01

Baseline: `12d7c2a9988d53a9dcec542b82c99a435f4015d4`. **222 tests passed, zero failures/skips; Vite production build passed.** This is a small clarity-per-pixel improvement, not an increase in rendering resolution or a guarantee of unchanged phone frame rate.

## Findings and chosen changes

1. **Drawing-buffer resolution is intentionally capped.** The game and motion inspector already request antialiasing. Canvas CSS fills its container without a blur filter or transform scale. The DPR cap of 1.7 still undersamples high-density phones: 390×844 CSS pixels at device DPR 3 render to 663×1434, about 32% of the native pixel count. The previous source comment claiming native small-screen density was corrected. Increasing the cap to 2 would mean 780×1688 pixels, **38.4% more raster pixels**, so it is not enabled, and no optional/adaptive mode ships without device evidence. The existing 3-million-pixel ceiling remains.
2. **Pitch-only filtering is bounded at 2× anisotropy**, or 1× if the hardware lacks support. The existing 1024² canvas texture, trilinear mipmaps, magnification filter and sRGB declaration remain unchanged. This targets grazing-angle texture blur; it does not sharpen players, ball silhouettes or the entire image. It adds texture-sampling work, not a new pass or larger texture, and its actual mobile GPU cost is unmeasured.
3. **Field paint has a physical width.** Six straight GL lines and the penalty arc previously stayed one drawing-buffer pixel wide. They are replaced by 8 cm paint ribbons, with mitered corners and upward normals. The ribbons batch into the existing goal-line material and do not cast shadows. This adds 140 small triangles while removing seven line submissions. It is not a model-detail or global geometry-density increase. Very distant paint can still project below a pixel and need antialiasing.
4. **Resizing avoids duplicate allocations.** In Three r180, `setPixelRatio()` already calls `setSize()`. Both callers previously immediately called `setSize()` again. Game and inspector now share a guarded `setDrawingBufferSize(width,height,ratio)` call; identical repeated logical dimensions/DPR do nothing. The inspector keeps logical viewport/scissor semantics. Window resize still handles DPR/viewport changes. No periodic or per-frame buffer reallocation is added.
5. **Opt-in diagnostics report actual buffer dimensions and context AA state.** `?profile` shows drawing-buffer width×height, effective DPR and the result of `getContextAttributes().antialias`, queried once at setup. Antialiasing was already requested before this pass. This does not measure sample count or GPU duration, and does not silently enable a new AA technique.

## Quantitative gates

[Before census](image-clarity/render-before.json) / [after census](image-clarity/render-after.json) are CPU scene candidates before culling, including two jersey numbers, **not observed WebGL draw calls**.

| Quantity | Before | After |
| --- | ---: | ---: |
| Main candidates | 45 | 38 |
| Shadow candidates | 22 | 22 |
| Main mesh triangles | 63,470 | 63,610 |
| Shadow mesh triangles | 36,790 | 36,790 |
| Generated canvas RGBA+mipmap estimate | 5,963,772 B | 5,963,772 B |
| Default maximum DPR | 1.7 | 1.7 |
| Maximum drawing-buffer pixel budget | 3,000,000 | 3,000,000 |

Triangle growth is **0.22%**, solely field paint. Its raw vertex/normal/UV/index payload is about 14.3 kB before geometry batching overhead. All character GLBs, compressed editable Blender sources, textures, bones, animations, motion/contact corrections and competitive physics are byte-unchanged. Shadow map remains 1024². No sharpening, upscale, SSAO, bloom, new light or new render pass was added.

Build: game chunk 53.50 kB / gzip 20.70 kB; shared rendering 1,171.42 kB / gzip 317.84 kB. Compared with the baseline, compressed game+rendering growth is approximately **0.54 kB**. The existing >500 kB shared-chunk warning remains.

Tests cover the 2× hardware cap and unsupported/nonfinite cases without changing mipmaps, 140-triangle geometry/normal/width constraints, unchanged phone/large-screen DPR limits, 100 repeated resize requests producing one resize call, orientation/DPR changes, invalid dimensions, actual Stadium feedback, inspector multiview/lifecycle, and all existing touch/motion/physics regressions.

## Visual evidence and scope

`export-pitch-clarity.mjs` projects the real new marking vertices and baseline lines through the actual advanced camera. `render-pitch-clarity.py` makes labeled CPU geometry diagnostics at portrait or landscape viewport sizes. These demonstrate the changed geometric width and camera perspective; **they do not render WebGL/MSAA or simulate anisotropic filtering**, and are not game screenshots. [Projection summary](image-clarity/projection-summary.json) separates across-field and along-field projected widths because foreshortening differs by direction.

The cloud localhost security block and Chromium socket restriction remain respected. Actual browser filtering A/B, real phone GPU time, sustained frame pacing, battery/thermal behavior and physical-device gestures remain untested. Fewer candidate draws and unchanged pixels do not prove equal performance: anisotropy and broader paint coverage still change sampling/fragment work. If a device shows cost without useful pitch detail, the bounded pitch filter can be returned to 1×; do not increase DPR blindly.

## Reproduce

```sh
npm test
npm run build
node tools/qa/audit-render-budget.mjs --scene-ref 12d7c2a
node tools/qa/audit-render-budget.mjs --check
node tools/qa/export-pitch-clarity.mjs /tmp/pitch.json 960 540
python tools/qa/render-pitch-clarity.py /tmp/pitch.json /tmp/pitch.png
```

## Primary references

- [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html): drawing-buffer size/DPR costs and explicit sizing
- [Three.js Texture](https://threejs.org/docs/pages/Texture.html), [texture filtering](https://threejs.org/manual/pages/textures.html): mipmaps, filtering and anisotropy
- [Khronos anisotropy specification](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_filter_anisotropic.txt): anisotropy throughput tradeoffs; the hardware maximum is not a free-performance recommendation
- [Three r180 renderer implementation](https://github.com/mrdoob/three.js/blob/r180/src/renderers/WebGLRenderer.js): `setPixelRatio`, `setSize`, `setDrawingBufferSize` behavior verified against the installed version
- [MDN context attributes](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes): inspect the actual context, not only requested options
- [Three color management](https://threejs.org/manual/pages/color-management.html): existing sRGB pipeline retained
