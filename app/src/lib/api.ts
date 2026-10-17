// Typed wrappers around the Rust commands.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { once } from '@tauri-apps/api/event';
import type { Area, Monitor, Project, ProjectSummary, WindowRect } from './types';

export interface AppInfo {
  version: string;
  projectsDir: string | null;
  extensionDir: string;
  encoder: string | null;
  platform: 'windows' | 'macos' | 'linux';
}

export interface ExtStatus {
  connected: number;
  version: string | null;
}

export interface ExportSpec {
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  keeps: [number, number][];
  blurs: { start: number; end: number; x: number; y: number; w: number; h: number }[];
  screenBox: { x: number; y: number; w: number; h: number };
  cam: { box: { x: number; y: number; w: number; h: number }; offset: number; video: boolean; audio: boolean } | null;
  background: string;
  duration: number;
  /** zoompan expressions of output time, or null for no zoom. */
  zoom: { z: string; x: string; y: string } | null;
}

export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),
  extStatus: () => invoke<ExtStatus>('ext_status'),
  listMonitors: () => invoke<Monitor[]>('list_monitors'),
  beginRecording: (options: { monitor: Monitor; area: Area | null; camera: boolean; mic: boolean }) =>
    invoke<string>('begin_recording', { options }),
  camBegin: (mime: string, startedAt: number, video: boolean, audio: boolean) =>
    invoke<void>('cam_begin', { mime, startedAt, video, audio }),
  camChunk: (bytes: Uint8Array) => invoke<void>('cam_chunk', bytes),
  startScreen: () => invoke<number>('start_screen'),
  togglePause: () => invoke<boolean>('toggle_pause'),
  stopRecording: () => invoke<string>('stop_recording'),
  cancelRecording: () => invoke<void>('cancel_recording'),
  /** Lets the user drag an area (or click a window) on the monitor. Null when cancelled. */
  pickArea: async (monitor: Monitor) => {
    const picked = new Promise<Area | null>((resolve) => once<Area | null>('area-picked', (e) => resolve(e.payload)));
    await invoke<void>('pick_area', { monitor });
    return picked;
  },
  pickerData: () => invoke<{ image: string; windows: WindowRect[]; monitor: Monitor } | null>('picker_data'),
  finishPick: (area: Area | null) => invoke<void>('finish_pick', { area }),
  listProjects: () => invoke<ProjectSummary[]>('list_projects'),
  loadProject: (dir: string) => invoke<Project>('load_project', { dir }),
  saveProject: (dir: string, project: Project) => invoke<void>('save_project', { dir, project }),
  deleteProject: (dir: string) => invoke<void>('delete_project', { dir }),
  writeTextFile: (path: string, contents: string) => invoke<void>('write_text_file', { path, contents }),
  exportVideo: (dir: string, spec: ExportSpec, ass: string, output: string) =>
    invoke<string>('export_video', { dir, spec, ass, output }),
  extractFrames: (dir: string, frames: { time: number; blurs: ExportSpec['blurs'] }[], srcWidth: number, srcHeight: number, outDir: string) =>
    invoke<string[]>('extract_frames', { dir, frames, srcWidth, srcHeight, outDir }),
};

/** Joins path segments with the separator the base path already uses. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

/** URL the webview can load a local file from (cache-busted). */
export function fileUrl(path: string, bust = ''): string {
  return convertFileSrc(path) + (bust ? `?v=${bust}` : '');
}
