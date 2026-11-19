export type Theme = 'light' | 'dark' | 'none';
export type Format = 'gif' | 'webm' | 'mp4';

export const TITLEBAR_HEIGHT = 40, RIPPLE_MS = 400, RIPPLE_RADIUS = 24;

export interface Overlay { cursor: { x: number; y: number } | null; ripples: Array<{ x: number; y: number; age: number }>; address: string }
/** width/height are the viewport size. */
export interface InitOptions { width: number; height: number; fps: number; theme: Theme; formats: Format[] }
/** finish() returns base64 bytes per format. */
export interface StudioApi { init(o: InitOptions): Promise<void>; addFrame(pngBase64: string, overlay: Overlay): Promise<void>; finish(): Promise<Partial<Record<Format, string>>> }
declare global { interface Window { webtape: StudioApi } }

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Delay of GIF frame k in ms: whole centiseconds, distributed so the running total tracks real time. */
export function gifDelayMs(k: number, fps: number): number {
  return (Math.round((k + 1) * 100 / fps) - Math.round(k * 100 / fps)) * 10;
}

/** Address bar text: never shows query, hash or a local path, since recordings get published. */
export function addressText(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.host + u.pathname;
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf('/') + 1));
  } catch { /* invalid URL or bad escape: show nothing */ }
  return '';
}

export function outputSize(w: number, h: number, theme: Theme): { width: number; height: number } {
  return { width: w, height: theme === 'none' ? h : h + TITLEBAR_HEIGHT };
}

export function formatBytes(n: number): string {
  return n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
}

export function rippleAge(frame: number, clickFrame: number, fps: number): number {
  return (frame - clickFrame + 1) * 1000 / fps / RIPPLE_MS;
}
