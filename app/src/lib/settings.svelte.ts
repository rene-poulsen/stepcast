// Remembered choices on the home screen. Stored per device in localStorage.
import type { Lang } from './types';

export interface Settings {
  camera: boolean;
  mic: boolean;
  cameraId: string;
  micId: string;
  lang: Lang;
  monitor: number;
  /** Record the whole screen or an area of it. */
  mode: 'screen' | 'area';
  onboarded: boolean;
}

const KEY = 'stepcast.settings';

function load(): Settings {
  const defaults: Settings = {
    camera: false,
    mic: true,
    cameraId: '',
    micId: '',
    lang: navigator.language.toLowerCase().startsWith('da') ? 'da' : 'en',
    monitor: -1,
    mode: 'screen',
    onboarded: false,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
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
