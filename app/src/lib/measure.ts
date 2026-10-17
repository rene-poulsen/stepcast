// Measures label text with the same font libass uses, so pills fit their text.
import interUrl from '../../src-tauri/fonts/Inter-SemiBold.ttf?url';
import type { Measure } from './ass';

let ctx: CanvasRenderingContext2D | null = null;
let loaded: Promise<void> | null = null;

export function loadMeasureFont(): Promise<void> {
  loaded ??= (async () => {
    const face = new FontFace('Stepcast Label', `url(${interUrl})`);
    await face.load();
    document.fonts.add(face);
  })();
  return loaded;
}

export const measure: Measure = (text, size) => {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.56;
  ctx.font = `${size}px "Stepcast Label"`;
  return ctx.measureText(text).width;
};

export { interUrl };
