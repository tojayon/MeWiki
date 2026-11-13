export type TextureImageMode = 'original' | 'gray' | 'tint';
export function textureCrop(width: number, height: number, percent: number, horizontal: number, vertical: number) {
  if (![width, height, percent, horizontal, vertical].every(Number.isFinite) || width < 1 || height < 1 || percent < 20 || percent > 100 || horizontal < 0 || horizontal > 100 || vertical < 0 || vertical > 100) throw new Error('纹理裁切区域无效。');
  const size = Math.max(1, Math.round(Math.min(width, height) * percent / 100));
  return { x: Math.round((width - size) * horizontal / 100), y: Math.round((height - size) * vertical / 100), size };
}
/** Small local raster only. A summed-area table removes slow lighting changes in O(pixels). */
export function processTexturePixels(source: Uint8ClampedArray, width: number, height: number, mode: TextureImageMode, color: string, flatten: boolean): Uint8ClampedArray<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512 || source.length !== width * height * 4 || !/^#[\da-f]{6}$/i.test(color)) throw new Error('纹理处理尺寸无效。');
  const output = new Uint8ClampedArray(source.length), light = new Float32Array(width * height), integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, i = pixel * 4;
      light[pixel] = source[i] * .2126 + source[i + 1] * .7152 + source[i + 2] * .0722;
      row += light[pixel]; integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const radius = Math.max(2, Math.round(Math.min(width, height) / 8));
  // Darken the background color so the tint stays visible on that same background.
  const tint = [1, 3, 5].map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * .65));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, i = pixel * 4;
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1), top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    const sum = integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right] - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left];
    const delta = flatten ? 160 - sum / ((right - left) * (bottom - top)) : 0;
    const luminance = Math.min(255, Math.max(0, light[pixel] + delta));
    for (let channel = 0; channel < 3; channel++) output[i + channel] = mode === 'gray' ? luminance : mode === 'tint' ? tint[channel] : source[i + channel] + delta;
    output[i + 3] = mode === 'tint' ? source[i + 3] * Math.min(1, (255 - luminance) / 128) : source[i + 3];
  }
  return output;
}
/** Mirrored quadrants make opposite tile edges equal, without blending away the grain. */
export function mirrorTexturePixels(source: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512 || source.length !== width * height * 4) throw new Error('纹理处理尺寸无效。');
  const output = new Uint8ClampedArray(width * height * 16);
  for (let y = 0; y < height * 2; y++) for (let x = 0; x < width * 2; x++) {
    const from = ((y < height ? y : height * 2 - y - 1) * width + (x < width ? x : width * 2 - x - 1)) * 4;
    output.set(source.subarray(from, from + 4), (y * width * 2 + x) * 4);
  }
  return output;
}
