// Output formats: the size of the exported video, picked per platform.

export type FormatId = 'original' | '16:9' | '9:16' | '4:5' | '1:1' | '3:4' | '4:3';

export interface Format {
  id: FormatId;
  /** Output size in pixels; 0 for `original`, which keeps the recorded screen's size. */
  width: number;
  height: number;
  /** Where the format is used, shown under its name (`original` has a translated hint instead). */
  platforms: string;
}

export const FORMATS: Format[] = [
  { id: 'original', width: 0, height: 0, platforms: '' },
  { id: '16:9', width: 1920, height: 1080, platforms: 'YouTube, LinkedIn, Vimeo' },
  { id: '9:16', width: 1080, height: 1920, platforms: 'Reels, TikTok, Shorts, Snapchat' },
  { id: '4:5', width: 1080, height: 1350, platforms: 'Instagram & Facebook feed' },
  { id: '1:1', width: 1080, height: 1080, platforms: 'Feed posts, LinkedIn, X' },
  { id: '3:4', width: 1080, height: 1440, platforms: 'Instagram grid, Pinterest' },
  { id: '4:3', width: 1440, height: 1080, platforms: 'Presentations, courses' },
];

/** The formats on offer: `original` only when there is a screen recording to take the size from. */
export function formatsFor(hasScreen: boolean): Format[] {
  return hasScreen ? FORMATS : FORMATS.filter((f) => f.id !== 'original');
}

/** Output size for a format. Without a screen, `original` falls back to 16:9. */
export function outputSize(id: FormatId, screen: { width: number; height: number } | null): { width: number; height: number } {
  const f = FORMATS.find((f) => f.id === id && f.width) ?? (screen ? null : FORMATS[1]);
  return f ? { width: f.width, height: f.height } : { width: screen!.width, height: screen!.height };
}

/** Width / height of a format, for drawing its shape and crop guides. */
export function formatRatio(id: FormatId, screen: { width: number; height: number } | null): number {
  const { width, height } = outputSize(id, screen);
  return width / height;
}
