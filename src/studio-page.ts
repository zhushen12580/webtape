import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output, type OutputFormat, QUALITY_HIGH, WebMOutputFormat } from 'mediabunny';
import { gifDelayMs, outputSize, RIPPLE_RADIUS, TITLEBAR_HEIGHT, type Format, type InitOptions, type Overlay, type StudioApi } from './shared';

const BAR = {
  light: { bg: '#ececf0', line: '#d4d4d8', pill: '#ffffff', text: '#4b4b55' },
  dark: { bg: '#2a2a2e', line: '#151518', pill: '#3a3a40', text: '#d0d0d8' },
};
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];
const PILL_X = 88, PILL_Y = 8, PILL_H = 24, PILL_PAD = 10;
// Classic arrow, tip at the origin.
const ARROW = [[0, 0], [0, 17], [4.5, 13], [7.5, 19.5], [10, 18.5], [7, 12], [12.5, 12]];
const VIDEO = {
  mp4: { codec: 'avc', name: 'MP4 (H.264)', alt: '.webm', format: () => new Mp4OutputFormat({ fastStart: 'in-memory' }) },
  webm: { codec: 'vp9', name: 'WebM (VP9)', alt: '.mp4', format: () => new WebMOutputFormat() },
} as const;

let opts: InitOptions;
let ctx: CanvasRenderingContext2D;
let gif: ReturnType<typeof GIFEncoder>;
let prev: Uint32Array | null = null;
let frame = 0;
const videos: Array<{ format: 'webm' | 'mp4'; output: Output<OutputFormat, BufferTarget>; source: CanvasSource }> = [];

/** One GIF frame per logical frame; pixels equal to the previous frame become transparent (dispose = keep). */
function encodeGifFrame(): void {
  const { width: w, height: h } = ctx.canvas;
  const px = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
  const changed = new Uint32Array(px.length);
  let count = 0;
  for (let i = 0; i < px.length; i++) if (!prev || px[i] !== prev[i]) changed[count++] = i;
  const sub = new Uint32Array(count);
  for (let j = 0; j < count; j++) sub[j] = px[changed[j]];
  const subBytes = new Uint8Array(sub.buffer);
  const palette = count ? quantize(subBytes, 255) : [[0, 0, 0]];
  const subIdx = applyPalette(subBytes, palette);
  const delay = gifDelayMs(frame, opts.fps);
  if (!prev) {
    gif.writeFrame(subIdx, w, h, { palette, delay, repeat: 0 });
  } else {
    const t = palette.length;
    const index = new Uint8Array(px.length).fill(t);
    for (let j = 0; j < count; j++) index[changed[j]] = subIdx[j];
    gif.writeFrame(index, w, h, { palette: [...palette, [0, 0, 0]], delay, transparent: true, transparentIndex: t, dispose: 1 });
  }
  prev = px;
}

/** Window chrome: traffic lights and an address pill whose text is ellipsized and clipped to the pill. */
function drawTitleBar(theme: 'light' | 'dark', address: string): void {
  const c = BAR[theme], w = ctx.canvas.width;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, TITLEBAR_HEIGHT);
  ctx.fillStyle = c.line;
  ctx.fillRect(0, TITLEBAR_HEIGHT - 1, w, 1);
  LIGHTS.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(20 + 18 * i, 20, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  const pillW = w - 2 * PILL_X;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(PILL_X, PILL_Y, pillW, PILL_H, 6);
  ctx.fillStyle = c.pill;
  ctx.fill();
  ctx.clip();
  ctx.font = '13px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.text;
  let text = address;
  const chars = [...address];
  while (chars.length && ctx.measureText(text).width > pillW - 2 * PILL_PAD) {
    chars.pop();
    text = chars.join('') + '…';
  }
  ctx.fillText(text, w / 2, PILL_Y + PILL_H / 2);
  ctx.restore();
}

/** Ripples under the cursor; page coordinates shifted down by the title bar. */
function drawOverlay({ cursor, ripples }: Overlay, barH: number): void {
  for (const r of ripples) {
    ctx.fillStyle = `rgba(37,99,235,${0.45 * (1 - r.age)})`;
    ctx.beginPath();
    ctx.arc(r.x, r.y + barH, RIPPLE_RADIUS * r.age, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!cursor) return;
  ctx.save();
  ctx.translate(cursor.x, cursor.y + barH);
  ctx.beginPath();
  for (const [x, y] of ARROW) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const url = reader.result as string; resolve(url.slice(url.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
}

const studio: StudioApi = {
  async init(o) {
    opts = o;
    const size = outputSize(o.width, o.height, o.theme);
    const canvas = document.createElement('canvas');
    Object.assign(canvas, size);
    ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    gif = GIFEncoder();
    for (const format of o.formats) {
      if (format === 'gif') continue;
      const v = VIDEO[format];
      if (!(await canEncodeVideo(v.codec, size))) throw new Error(`${v.name} encoding is not supported by this Chromium build; use ${v.alt} or .gif`);
      const output = new Output({ format: v.format(), target: new BufferTarget() });
      const source = new CanvasSource(canvas, { codec: v.codec, quality: QUALITY_HIGH });
      output.addVideoTrack(source, { frameRate: o.fps });
      await output.start();
      videos.push({ format, output, source });
    }
  },
  async addFrame(png, overlay) {
    const barH = opts.theme === 'none' ? 0 : TITLEBAR_HEIGHT;
    if (opts.theme !== 'none') drawTitleBar(opts.theme, overlay.address);
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    ctx.drawImage(bitmap, 0, barH);
    bitmap.close();
    drawOverlay(overlay, barH);
    if (opts.formats.includes('gif')) encodeGifFrame();
    for (const v of videos) await v.source.add(frame / opts.fps, 1 / opts.fps);
    frame++;
  },
  async finish() {
    const out: Partial<Record<Format, string>> = {};
    if (opts.formats.includes('gif')) {
      gif.finish();
      out.gif = await toBase64(gif.bytes());
    }
    for (const v of videos) {
      await v.output.finalize();
      out[v.format] = await toBase64(new Uint8Array(v.output.target.buffer!));
    }
    return out;
  },
};

window.webtape = studio;
