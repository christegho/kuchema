// Shared by the image renderer and editor so previews and exports use the same ground.
export const DEFAULT_GROUND = '#000000';

/** The ground beneath transparent cuts is always pure black, whatever a model or saved project chose. */
// eslint-disable-next-line no-unused-vars
export function canvasGround(colour) {
  return DEFAULT_GROUND;
}
