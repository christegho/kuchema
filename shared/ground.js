// Shared by the image renderer and editor so previews and exports use the same ground.
// The pale blue at the centre of paleblue.jpeg (mean of its central 2%), chosen by the artist.
export const DEFAULT_GROUND = '#d4e4f4';

/** The ground beneath transparent cuts is always this pale blue, whatever a model or saved project chose. */
// eslint-disable-next-line no-unused-vars
export function canvasGround(colour) {
  return DEFAULT_GROUND;
}
