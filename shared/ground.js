// Shared by the image renderer and editor so previews and exports use the same ground.
export const DEFAULT_GROUND = '#183f3b';

/** Keep a coloured ground beneath transparent cuts; never substitute white paper. */
export function canvasGround(colour) {
  if (typeof colour !== 'string' || !/^#[0-9a-f]{6}$/i.test(colour)) return DEFAULT_GROUND;
  const [r, g, b] = colour.slice(1).match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  // Reject white, cream and pale grey grounds while retaining darker water/earth tones.
  return .2126 * r + .7152 * g + .0722 * b > .55 ? DEFAULT_GROUND : colour;
}
