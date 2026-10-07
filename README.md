# Kuchema

A local collage tool for *Kuchema: The Gathering*. React, Express, Sharp and a local YOLO/SAM worker. No accounts or collections. Deployment is deferred.

[Development explorations, research and references](development-notes.md)

[TouchDesigner integration guide](touchdesigner.md)

## Run

```sh
npm install
npm run setup:vision
npm run dev
```

Open **http://127.0.0.1:3000**. Node 22+ and Python 3.10+ are required. The existing workspace already has dependencies and model weights. `OPENROUTER_API_KEY` stays in the server's `.env`. For a production build locally, use `npm run build` and `npm start`.

## Use

- **Archive**: `archive/` is the official source, imported recursively at startup. Root photographs are general Chikukwa references; `Chikukwa Water Sites/` (including `sacred water sites/`) supplies water references; `collages-style-guide/` supplies composition references; `people/` supplies direct people cutouts. Select images to constrain the random category sampling, or leave the selection empty. Original files and older studies are retained; old sample images are excluded from new official selections.
- **Context**: edit the project-wide system prompt and add contributor accounts, relationships, constraints and other text. The default system prompt and editable starting image prompt are derived from the creative sections of `brief.md`. The MOU's legal sections and private folder links are excluded from model context. Original documents remain unchanged.
- **Options**: choose **6–20 distinct images**, whether archive people cutouts appear in the collage, individual material treatments and image model. Treatment choices persist in this browser; uncheck anything you dislike, or clear all treatments. **Include people** is on by default. Archive images still inform the VLM when final archive inclusion is off. Multiple crops of one image do not count as separate images.
- Enter a prompt and create. **Studies** retains attempts and cost records. **How this image was made** contains the advance JSON plan, research, transformations, actual cutouts, draft, review and coverage check.
- **Edit** supports placement, rotation, opacity, polygon cuts and undo/redo on assembled fragments. Raw archive photographs cannot be pasted from the archive gallery. **Save image** exports a 2400 × 1500 PNG. **View** hides the interface; Escape restores it.

The first startup imports and normalizes the official archive and can take several minutes. Subsequent startups reuse unchanged images. Duplicate files count as one photograph; if a file is also in `people/`, it is assigned to direct cutout use. Import errors are reported in the server log.

Photographs are kept locally: `archive/` and `images_test/` are excluded from Git. A fresh checkout needs the official archive copied into `archive/` before starting the app. Automated tests use synthetic images and do not require the private archive; the optional paid live test requires local sample photos in `images_test/`.

## Automatic sequence

1. Randomly sample distinct official photographs within each category, without replacement. Use `max(2, ceil(count / 3))` general Chikukwa references and the same number of water references, including the sacred-water subfolder in the water pool. Select exactly one collage to inform composition only. With people enabled, use `min(8, max(4, round(count × 0.4)))` people photographs; if only two or three are eligible, use those, but stop before paid calls if fewer than two are available. This gives four people sources for a six-image composition and eight for a twenty-image composition. All remaining components are generated environment/material images. Each generated component receives one general and one water reference, cycling through the randomly sampled pools so every selected reference reaches the image model. Context/reference photographs do not count as final components. Category shortages, disabled references, or people inclusion without archive inclusion stop before paid calls.
2. Verify current provider availability, structured-output support, prices and **the complete sequence's cost before any paid call**.
3. Research the request, editable art direction, creative brief and supplied text with Qwen and Exa search. Findings require returned URL annotations.
4. A Qwen VLM sees the actual archive images, their metadata, the supplied texts and research. The retrieved originals and required generations occupy fixed source slots, and each image is paired explicitly with its slot to prevent subject/source swaps. It writes an **advance JSON plan**: source IDs or generation prompts, reference IDs, extraction subjects, transformation types/reasons, boundary treatment, normalized position, scale, rotation and layer order. Duplicate originals and permission violations stop execution.
5. Generate only environmental/material source images. People are never generated: SAM crops complete visible people or groups directly from the selected original people photographs, preserving their appearance. People and collage-style photographs are excluded from image-generation references even if their reference permission is enabled. The single collage reference is shown to the visual planner for layout, scale, overlap and rhythm only. General/water references default to generation permission; people default to crop permission. Contributor permission edits survive reimports.
6. Apply a restrained selection of enabled treatments to generated images **before grounding or cropping**. Options include water refraction, reflection echoes, sediment washes, capillary staining, contour impressions, paper grain, copy softness, offset inks, tonal steps, eroded impressions and an earth/water palette wash. The planner receives the selected options, descriptions and strength limits. Checked options are available, not compulsory: at most two treatment types and `min(3, ceil(generatedCount / 2))` treated fragments, one effect each. Excess proposed treatments are removed and recorded in `treatmentAdjustments`. Strengths are capped to preserve photographic detail. No treatment is mandatory, including water refraction; all-off produces untreated generated material. People stay untransformed. Originals remain intact and every derivative records its parent, root and reason.
7. The VLM sees the transformed versions and supplies fresh boxes and positive points. It declares whether coordinates use pixels or a 0–1000 grid; the server resolves inconsistent declarations against the actual supplied dimensions and records the result. For an archive person or group, the VLM must request the whole visible figure and YOLO replaces its box with full-person detections; an uncertain human fragment is rejected. SAM 2.1 then performs segmentation. A **silhouette** uses its alpha mask; **residue** expands the mask slightly; a **field** expands the SAM mask while retaining an irregular alpha edge and transparent corners. Automatic collages do not use whole rectangular photographs. The local worker rejects near-whole masks, limits environmental field expansion to the composition-directed subject, and the server checks actual alpha pixels before accepting a cut. Opaque rectangular results or cuts retaining more than 92% of the original are saved as failed parts for local retry; they are never pasted as a fallback.
8. Assemble the actual cuts using the advance plan, with at least two generated environmental fields sharing the ground. A VLM reviews the contact sheet, rendered draft and alpha-based visibility measurements. No single fragment may occupy more than 58% of the working canvas area. Local repair can shrink, enlarge within that cap, move and reorder cuts to expose hidden material; it also runs on fully covered canvases when sources are obscured.
9. Check actual mask coverage, each root image's visible contribution and the fraction remaining visible after overlap. Aim for **at least 99.5% canvas coverage**, every source contributing visibly, and at least 25% of each on-canvas fragment remaining visible. Legibility and the per-layer area cap take priority over filling the last gap. Automatic placement also caps enlargement at 2× the working pixels. Exposed canvas uses a deep water-green ground (`#183f3b`) by default; white, cream and pale-grey backgrounds are replaced consistently in planning, saved projects, previews and exports. Natural photographic highlights and archive people remain untouched. The coloured ground does not count as image coverage. Residual holes or heavily obscured sources are reported with the completed study; no extra paid repair loop runs.
10. If SAM times out, retry it once locally at a smaller working size. If that also fails, save the component as a failed part and compose the study from every successful component. **Retry part** reruns local detection and SAM against the saved image without repeating research, planning or generation; **Ignore** accepts the omission. If every local cut fails, the study record and all source material remain available, and the first successful part retry creates its canvas.

Plan coordinates use a 1600 × 1000 working canvas. Positions are centers; width is a canvas-width fraction, and height preserves aspect ratio. The final project stores exact rendered layer geometry, including coverage adjustments. The coverage audit samples alpha at 320 × 200; each counted root must contribute at least 0.2% of the canvas after occlusion. Layout fitting uses a 160 × 100 alpha grid and the final audit uses 320 × 200. This is a quantitative check, not a guarantee of artistic quality.

## Models and the $1.00 limit

| Role | Model |
| --- | --- |
| Research | Qwen3 30B A3B Instruct + Exa |
| Advance visual plan, transformed-image grounding, review | Qwen3 VL 235B A22B Instruct |
| Fixed-price 2K source generation | Seedream 4.5 |
| Premium choice | GPT Image 2.5 Sunburst — currently blocked by the strict cap |
| Local detection / cutting | YOLO11n / SAM 2.1 tiny |

The app makes four bounded language/vision calls plus the required image calls. Providers are checked and pinned before work starts; automatic paid retries and provider fallbacks are disabled. Full provider context is reserved at enforced input/output price ceilings, with bounded completion tokens, an Exa allowance, and 20% headroom on fixed image prices. Every reservation is persisted before sending its request. Failed or unreported calls retain their reservations; cheaper actual usage is not recycled into extra calls. Repeated request IDs return the same job.

The number of affordable new images depends on current quotes. If the complete requested configuration cannot fit **$1.00**, it stops before charging. Larger collages increase both the reference pools and the number of direct people sources, up to eight. Context/reference images do not count unless their pixels contribute to the final collage.

**Premium limitation:** OpenAI describes GPT Image 2.5 Sunburst as its most capable image generation/editing model. Its current OpenRouter endpoint charges variable image tokens and exposes no enforceable per-image maximum. The option is visible, but creation stops before any research or generation charges. It is not silently downgraded, and the app does not claim to reproduce ChatGPT's complete workflow. A verifiable bounded provider quote is needed before this option can run within the strict ceiling.

Prices and provider capabilities are verified at runtime; model names are not a promise of permanent availability. The ceiling relies on providers honoring advertised prices. Unexpected over-billing stops further calls. Local electricity and OpenRouter credit-purchase fees are outside API usage accounting.

Sources: [OpenRouter image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [Seedream pricing](https://openrouter.ai/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints), [GPT Image 2.5](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [its OpenRouter pricing](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.5-sunburst/endpoints), [Ultralytics SAM 2](https://docs.ultralytics.com/models/sam-2/), [YOLO11](https://docs.ultralytics.com/models/yolo11/). Ultralytics distribution uses [AGPL-3.0 or Enterprise terms](https://www.ultralytics.com/license).

## Storage and permissions

`data/studio.json` holds the shared archive, saved text, projects, studies and ledgers; writes are atomic. Back up the entire `data` directory, because project JSON references image files. Use one server process. A restart retains reservations and never retries paid calls automatically. Studies that had reached local cutting are restored with per-part retry controls using their saved transformed images and VLM observations.

Uploads accept JPEG, PNG, WebP, AVIF, HEIC and TIFF when supported by the decoder, up to 20 MB and 60 megapixels. `ARCHIVE_DIR=./archive` imports the official directory recursively at startup; an absolute override must use the same category folders. The legacy `./images_test` setting is automatically migrated to `./archive`. Add official images to the appropriate folder and restart the server. Unchanged imports preserve edited permissions and metadata; removed files leave historical assets available to old studies but are excluded from future selections. Originals remain private; working PNGs strip EXIF/GPS and fit within 4096 pixels. Public media routes expose working images only.

VLM analysis sends normalized working copies to OpenRouter. Generation references and transformations have separate per-image permissions. Keep sensitive/contextual restrictions in contributor metadata. Metadata is evidence for models, not executable instructions. No fine-tuning, video, seam inpainting, web-image harvesting or physically printed/scanned transformations are implemented.

## Verify

```sh
npm test
npm run build
npm run test:ui
```

These tests make no paid calls. They cover recursive official imports, random category quotas, direct people crops, composition-only references, and environment-only generation; distinct-image counts; reference and transformation permissions; grounding after transformation; alpha coverage; budget rejection; archive/context persistence; editing; export; desktop/mobile UI.

`RUN_LIVE_AI=1 node tests/live-pipeline.mjs` explicitly runs a paid integration test in an isolated `test-results/dense-studio` archive. It copies the five test images, permits those copies as generation references, and tests six distinct source images with one new generation. Successful API responses are cached for debugging. Normal app requests never use that cache or retry automatically. Live artifacts do not replace your current arrangement.
