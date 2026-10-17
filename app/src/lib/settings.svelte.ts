// Remembered choices on the home screen. Stored per device in localStorage.
import type { FormatId } from './formats';
import type { Lang } from './types';

/** What gets recorded: the desktop, the desktop and the webcam, or only the webcam. */
export type Source = 'screen' | 'both' | 'cam';

export interface Settings {
  source: Source;
  mic: boolean;
  cameraId: string;
  micId: string;
  lang: Lang;
  monitor: number;
  /** Record the whole screen or an area of it. */
  mode: 'screen' | 'area';
  /** The format last picked for each source, so switching source brings its format back. */
  formats: Record<Source, FormatId>;
  onboarded: boolean;
}

const KEY = 'stepcast.settings';

function load(): Settings {
  const defaults: Settings = {
    source: 'screen',
    mic: true,
    cameraId: '',
    micId: '',
    lang: navigator.language.toLowerCase().startsWith('da') ? 'da' : 'en',
    monitor: -1,
    mode: 'screen',
    formats: { screen: 'original', both: 'original', cam: '9:16' },
    onboarded: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Before sources, the webcam was a switch next to the screen recording.
    if (!saved.source && saved.camera) saved.source = 'both';
    delete saved.camera;
    return { ...defaults, ...saved, formats: { ...defaults.formats, ...saved.formats } };
  } catch {
    return defaults;
  }
}

export const settings = $state<Settings>(load());

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings just aren't remembered.
  }
}
