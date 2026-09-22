# Kuchema development explorations

This is a living account of the artistic, technical and research questions being explored in Kuchema. It describes the current system rather than promising that every possible direction has been resolved.

## Artistic direction

Kuchema is being developed as an image-making tool for an art installation. The central question is how an image archive can become active material for a new, situated collage without being reduced to a visual mood board. The work follows the supplied `brief.md`: water, land, cultivation, gathering, memory and possible environmental futures are treated as relationships rather than isolated motifs.

The collage should retain evidence of assembly. Irregular edges, overlaps, changes in scale and changes in photographic texture can remain visible, but every fragment needs a role in the image's logic. The system avoids a grid of rectangular pictures, arbitrary montage, open white canvas, heavy pixelation and enlarging a source beyond the detail it contains.

Each study uses between 6 and 20 distinct source images. These may be archive originals, generated images, or a mixture. Repeated crops from one original do not count as additional sources.

## Inputs and context

The image direction is informed by four kinds of material:

1. The user's image prompt.
2. Editable project context and an editable system prompt derived from the brief.
3. Archive images and their contributor captions, locality, relationship, tags and restrictions.
4. Web research returned with citations for the subject of the requested image.

Archive images are shown to the visual planner even when their pixels will not be used in the final collage. This allows the system to read environmental, material and photographic context before deciding what new source material is needed.

Each archive image has three separate permissions: cropping, AI generation reference use, and transformation before cropping. AI reference permission is explicit because a working copy is sent to OpenRouter and the selected model provider. The permission can be changed by opening an image in **Archive** and using **Allow this image as an AI generation reference**.

The creation options also separate two decisions:

- **Include archive in collage** controls whether archive pixels can enter the final image.
- **Include people** controls whether the plan may contain newly generated people. It is on by default.

## People and representation

The present archive photographs of people provide context and reference material, but their people are not cut out and inserted into a collage. Environmental areas in those photographs can still be used. When **Include people** is on and a people-bearing archive image is detected, the system requires at least one such image to have AI-reference permission. If no suitable permission exists, it stops before a paid model call.

Generated people are intended as fictional visual echoes of the archive rather than replacements for documented individuals. The generator receives permitted people-bearing photographs as direct visual references. Its prompt asks for documentary photography, ordinary contemporary clothing, realistic skin and anatomy, complete bodies or complete groups, and enough visible boundary for segmentation. It explicitly excludes cartoon, animation, children's-book, doll, mascot, glossy 3D and invented ceremonial aesthetics. It must not claim a person's identity or copy one identifiable face.

This remains an active problem. Text-to-image systems can reproduce racial and gender stereotypes even when prompts appear neutral. Prompting alone is therefore insufficient. The current approach combines direct visual references, narrow photographic instructions, a user-facing inclusion control and reviewable intermediate plans. Future evaluation should use a fixed set of prompts, several archive reference groups and human review of skin tone, facial variation, age, clothing, anatomy, activity and setting.

Relevant research and implementation references:

- Naik and Nushi document amplified demographic stereotypes in text-to-image output: [Social Biases through the Text-to-Image Generation Lens](https://aclanthology.org/2023.findings-emnlp.465/).
- Bianchi et al. measure stereotypes and representational harm at scale in generated images: [Easily Accessible Text-to-Image Generation Amplifies Demographic Stereotypes at Large Scale](https://arxiv.org/abs/2211.03759).
- A recent study examines colorism across text-to-image models: [Colorism in Text-to-Image Models](https://aclanthology.org/2026.eacl-srw.69/).
- The Monk Skin Tone work describes a ten-tone scale and the subjectivity of skin-tone annotation; it is useful for auditing a test set, not for turning a person into a prompt label: [Consensus and Subjectivity of Skin Tone Annotation for ML Fairness](https://research.google/pubs/consensus-and-subjectivity-of-skin-tone-annotation-for-ml-fairness/).
- Identity-preserving methods offer possible future reference conditioning, subject to consent and the requirement to avoid copying a documented individual: [InstantID](https://github.com/instantX-research/InstantID), [PhotoMaker](https://arxiv.org/abs/2312.04461), [DreamBooth](https://arxiv.org/abs/2208.12242) and [IP-Adapter documentation](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter).

## Agentic image process

The current process uses several bounded model calls rather than asking one image model to make a finished collage:

1. Retrieve relevant archive originals and detect people locally.
2. Research the requested subject and retain cited claims and uncertainties.
3. Ask a vision-language planner for structured JSON covering each distinct source: what to generate or select, what object or material to segment, why it belongs, its transformation, scale, position and layer order.
4. Validate that plan against source uniqueness, archive permissions, people inclusion, transformations and the cost cap.
5. Generate only the additional source photographs the plan requires. They currently run one at a time so each charge is recorded before the next call.
6. Apply planned transformations to working copies before segmentation.
7. Ask a vision-language model to locate the requested content, use YOLO for local people detection, and use SAM to make the cut.
8. Assemble irregular layers on a 2400 × 1500 canvas, then run a visual critique and bounded layout revision.
9. Publish the image even when a cut fails or a small uncovered area remains. Failed cuts can be retried individually or ignored.

The JSON plan is validated before generation. Six to twenty keys are required; archive source IDs cannot repeat; generated people cannot appear when **Include people** is off; people references must point to permitted people-bearing images; and the planned composition must include a substantial environmental field when needed to cover the canvas.

## Transformations

Transformations happen before cropping so that the segmented form inherits the transformed surface. Current choices include restrained material and registration changes, selective recolouring, and water-flow displacement. Water transformation remains part of the visual language because it can connect otherwise separate pieces through current, reflection, erosion and movement.

Recolouring is optional and follows colours supported by the brief and visible archive material, especially water, vegetation, soil, stone and printed matter. It should preserve skin tone, tonal depth and photographic texture. Heavy posterisation, coarse pixel effects and destructive enlargement are excluded.

People cuts preserve the whole visible person or group. Heads, faces, torsos and limbs are not planned as detached collage fragments.

## Models and cost

OpenRouter provides the hosted language, vision-language and image endpoints. Its [image-generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) describes image output and reference-image input through the API.

The current low-cost image route uses ByteDance Seedream 4.5 and verifies current provider prices before making a paid call. The premium option remains disabled when the provider does not expose a price that can be bounded safely. FLUX.2 Pro is a candidate for stronger multi-reference people generation because OpenRouter lists support for up to eight input images and megapixel-based pricing: [FLUX.2 Pro model information](https://openrouter.ai/black-forest-labs/flux.2-pro). Seedream model information and current rates are available from [OpenRouter's ByteDance Seed page](https://openrouter.ai/bytedance-seed).

Every creation has a hard **$1.00** projected-cost limit. The app reserves estimated costs before calls, updates the ledger from reported usage, and stops before charging if the requested configuration cannot be bounded within the cap. Displayed estimates remain approximate because provider pricing and reported usage can change.

## Questions still being tested

- Which reference-conditioned model best preserves the archive's collective visual qualities without reproducing one person's identity?
- How many people references provide useful context before competing visual signals reduce coherence?
- Should generated people be made as one complete group, as several full-body sources, or as both?
- Which composition rules make water operate as structure rather than decoration?
- How should contributor permissions distinguish resemblance, transformation, public display and model-provider processing?
- Which visual review criteria can detect infantile, stereotyped or anatomically weak output before it enters the collage?
- Can independent image generation calls run in parallel while reserving their combined maximum cost atomically and preserving cancellation and partial-failure recovery?
- How should the tool record model, prompt, references, transformations and source ancestry for installation audiences without cluttering the main interface?

## Reference websites

- The interface aims for the quiet, artwork-led restraint discussed in relation to [Humans of AI](https://humans-of.ai/), with controls secondary to the image.
- [Creative AI](https://creative-ai.org/) was an early visual reference, later superseded by the simpler installation-oriented direction.
- [OpenRouter's image model comparison](https://openrouter.ai/blog/insights/image-generation-models-compared/) is useful for periodically reassessing model quality, reference support, latency and cost.
