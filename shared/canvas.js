// The installation spans three 1920 × 1080 screens. New collages are composed directly in
// output pixels; projects saved before the panorama keep their 1600 × 1000 working canvas.
export const CANVAS = { width: 5760, height: 1080 };
export const LEGACY_CANVAS = { width: 1600, height: 1000 };
export const canvasOf = project => project?.canvas || LEGACY_CANVAS;
// Legacy projects were rendered at 1.5× their working canvas (2400 × 1500).
export const outputScale = project => project?.canvas ? 1 : 1.5;
