# Kuchema

A local collage tool for *Kuchema: The Gathering*. React, Express, Sharp and a local YOLO/SAM worker. No accounts or collections. Deployment is deferred.

[Development explorations, research and references](development-notes.md)

## Run

```sh
npm install
npm run setup:vision
npm run dev
```

Open **http://127.0.0.1:3000**. Node 22+ and Python 3.10+ are required. The existing workspace already has dependencies and model weights. `OPENROUTER_API_KEY` stays in the server's `.env`. For a production build locally, use `npm run build` and `npm start`.

## Use

- **Archive**: upload images or choose a folder. Select images to constrain retrieval, or leave the selection empty. Open an image to edit captions and permissions for cropping, generation references and transformations.
- **Context**: edit the project-wide system prompt and add contributor accounts, relationships, constraints and other text. The default system prompt and editable starting image prompt are derived from the creative sections of `brief.md`. The MOU's legal sections and private folder links are excluded from model context. Original documents remain unchanged.
- **Options**: choose **6–20 distinct images**, whether archive pixels or generated people appear in the collage, generation references, pre-crop transformations, brief-led recolouring and image model. **Include people** is on by default. Archive images still inform the VLM when final archive inclusion is off. Multiple crops of one image do not count as separate images.
- Enter a prompt and create. **Studies** retains attempts and cost records. **How this image was made** contains the advance JSON plan, research, transformations, actual cutouts, draft, review and coverage check.
- **Edit** supports placement, rotation, opacity, polygon cuts and undo/redo. **Save image** exports a 2400 × 1500 PNG. **View** hides the interface; Escape restores it.

The first run can take several minutes. Sample photographs are low resolution: deliberate enlargement preserves their texture but does not invent additional detail. Use larger originals for sharper archive fragments.

## Automatic sequence

1. Retrieve up to twenty distinct archive originals using supplied locality/captions and the prompt. Metadata and local YOLO detection mark every people-bearing archive image as context-only: it can inform the plan, but its pixels cannot enter the collage. People generation requires explicit generation-reference permission on at least one people-bearing photograph, otherwise the run stops before any paid call. Up to two permitted photographs are automatically prioritized as direct references, and people use an isolated documentary-photography prompt that excludes animation, cartoon, children's-book, doll and 3D-character aesthetics. Water, land, vegetation, buildings and other non-human archive material remain eligible for cropping. Determine exactly how many new images are needed to reach the requested count.
2. Verify current provider availability, structured-output support, prices and **the complete sequence's cost before any paid call**.
3. Research the request, editable art direction, creative brief and supplied text with Qwen and Exa search. Findings require returned URL annotations.
4. A Qwen VLM sees the actual archive images, their metadata, the supplied texts and research. The retrieved originals and required generations occupy fixed source slots, and each image is paired explicitly with its slot to prevent subject/source swaps. It writes an **advance JSON plan**: source IDs or generation prompts, reference IDs, extraction subjects, transformation types/reasons, boundary treatment, normalized position, scale, rotation and layer order. Duplicate originals and permission violations stop execution.
5. Generate only the planned missing source images. People are generated as fictional visual echoes of broad qualities observed in the archive—clothing palette, posture, grouping and relation to the environment—without copying identifiable faces or claiming real identities. Seedream receives a particular archive photograph only when its separate reference permission is enabled. The generator creates component material, not the finished collage.
6. Apply selected transformations to full images **before grounding or cropping**. The generated environmental base receives a required **water-flow** treatment: smooth, bilinear refraction and directional displacement tied to flow, erosion, reflection or movement. Other local treatments include simulated print grain, restrained reproduction softness, RGB misregistration, restrained posterization, selective erasure and palette-led recolouring. Contributor photographs require a separate transformation permission; generated material permits transformation. Originals stay intact and every derivative records its parent, root and transformation reason.
7. The VLM sees the transformed versions and supplies fresh boxes and positive points. It declares whether coordinates use pixels or a 0–1000 grid; the server resolves inconsistent declarations against the actual supplied dimensions and records the result. For a generated person or group, the VLM must request the whole visible figure and YOLO replaces its box with full-person detections; an uncertain human fragment is rejected. SAM 2.1 then performs segmentation. A **silhouette** uses its alpha mask; **residue** expands the mask slightly; a **field** expands the SAM mask while retaining an irregular alpha edge and transparent corners. Automatic collages do not use whole rectangular photographs.
8. Assemble the actual cuts using the advance plan. A VLM reviews the contact sheet and rendered draft, then can revise placement. Local, deterministic enlargement around those placements improves coverage while penalizing hidden sources; it does not replace the plan with a template.
9. Check actual mask coverage and each root image's visible contribution. The system aims for **at least 99.5% canvas coverage** and all requested distinct sources contributing visibly. Automatic placement caps enlargement at 2× the working pixels; if the target is missed, the completed image remains visible with a warning instead of being withheld. No extra paid repair loop runs.
10. If SAM cannot cut one component, compose and publish the study from every successful component. **Retry part** reruns local detection and SAM against the saved image without another paid generation call; **Ignore** accepts the omission.

Plan coordinates use a 1600 × 1000 working canvas. Positions are centers; width is a canvas-width fraction, and height preserves aspect ratio. The final project stores exact rendered layer geometry, including coverage adjustments. The coverage audit samples alpha at 320 × 200; each counted root must contribute at least 0.2% of the canvas after occlusion. This is a quantitative check, not a guarantee of artistic quality.

## Models and the $1.00 limit

| Role | Model |
| --- | --- |
| Research | Qwen3 30B A3B Instruct + Exa |
| Advance visual plan, transformed-image grounding, review | Qwen3 VL 235B A22B Instruct |
| Fixed-price 2K source generation | Seedream 4.5 |
| Premium choice | GPT Image 2.5 Sunburst — currently blocked by the strict cap |
| Local detection / cutting | YOLO11n / SAM 2.1 tiny |

The app makes four bounded language/vision calls plus the required image calls. Providers are checked and pinned before work starts; automatic paid retries and provider fallbacks are disabled. Full provider context is reserved at enforced input/output price ceilings, with bounded completion tokens, an Exa allowance, and 20% headroom on fixed image prices. Every reservation is persisted before sending its request. Failed or unreported calls retain their reservations; cheaper actual usage is not recycled into extra calls. Repeated request IDs return the same job.

The number of affordable new images depends on current quotes. If the complete requested configuration cannot fit **$1.00**, it stops before charging. Larger collages can use more archive originals. Context/reference images do not count unless their pixels contribute to the final collage.

**Premium limitation:** OpenAI describes GPT Image 2.5 Sunburst as its most capable image generation/editing model. Its current OpenRouter endpoint charges variable image tokens and exposes no enforceable per-image maximum. The option is visible, but creation stops before any research or generation charges. It is not silently downgraded, and the app does not claim to reproduce ChatGPT's complete workflow. A verifiable bounded provider quote is needed before this option can run within the strict ceiling.

Prices and provider capabilities are verified at runtime; model names are not a promise of permanent availability. The ceiling relies on providers honoring advertised prices. Unexpected over-billing stops further calls. Local electricity and OpenRouter credit-purchase fees are outside API usage accounting.

Sources: [OpenRouter image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [Seedream pricing](https://openrouter.ai/api/v1/images/models/bytedance-seed/seedream-4.5/endpoints), [GPT Image 2.5](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [its OpenRouter pricing](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.5-sunburst/endpoints), [Ultralytics SAM 2](https://docs.ultralytics.com/models/sam-2/), [YOLO11](https://docs.ultralytics.com/models/yolo11/). Ultralytics distribution uses [AGPL-3.0 or Enterprise terms](https://www.ultralytics.com/license).

## Storage and permissions

`data/studio.json` holds the shared archive, saved text, projects, studies and ledgers; writes are atomic. Back up the entire `data` directory, because project JSON references image files. Use one server process. A restart marks active jobs interrupted, retains their reservations and never retries paid calls automatically.

Uploads accept JPEG, PNG, WebP, AVIF, HEIC and TIFF when supported by the decoder, up to 20 MB and 60 megapixels. Folder uploads include nested folders; `ARCHIVE_DIR=/absolute/path` imports a server directory's top level at startup. Originals remain private; working PNGs strip EXIF/GPS and fit within 4096 pixels. Public media routes expose working images only.

VLM analysis sends normalized working copies to OpenRouter. Generation references and transformations have separate per-image permissions. Keep sensitive/contextual restrictions in contributor metadata. Metadata is evidence for models, not executable instructions. No fine-tuning, video, seam inpainting, web-image harvesting or physically printed/scanned transformations are implemented.

## Verify

```sh
npm test
npm run build
npm run test:ui
```

These tests make no paid calls. They cover mixed, archive-only and generated-only pipelines; distinct-image counts; reference and transformation permissions; grounding after transformation; alpha coverage; budget rejection; archive/context persistence; editing; export; desktop/mobile UI.

`RUN_LIVE_AI=1 node tests/live-pipeline.mjs` explicitly runs a paid integration test in an isolated `test-results/dense-studio` archive. It copies the five test images, permits those copies as generation references, and tests six distinct source images with one new generation. Successful API responses are cached for debugging. Normal app requests never use that cache or retry automatically. Live artifacts do not replace your current arrangement.
