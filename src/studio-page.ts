import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { gifDelayMs, outputSize, TITLEBAR_HEIGHT, type InitOptions, type StudioApi } from './shared';

const BAR = {
  light: { bg: '#ececf0', line: '#d4d4d8', pill: '#ffffff', text: '#4b4b55' },
  dark: { bg: '#2a2a2e', line: '#151518', pill: '#3a3a40', text: '#d0d0d8' },
};
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];
const PILL_X = 88, PILL_Y = 8, PILL_H = 24, PILL_PAD = 10;

let opts: InitOptions;
let ctx: CanvasRenderingContext2D;
let gif: ReturnType<typeof GIFEncoder>;
let prev: Uint32Array | null = null;
let frame = 0;

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
  frame++;
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
    // Video formats land in Task 13.
    const video = o.formats.find(f => f !== 'gif');
    if (video) throw new Error(`${video} output is not supported yet`);
    opts = o;
    const canvas = document.createElement('canvas');
    Object.assign(canvas, outputSize(o.width, o.height, o.theme));
    ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    gif = GIFEncoder();
  },
  async addFrame(png, overlay) {
    const barH = opts.theme === 'none' ? 0 : TITLEBAR_HEIGHT;
    if (opts.theme !== 'none') drawTitleBar(opts.theme, overlay.address);
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    ctx.drawImage(bitmap, 0, barH);
    bitmap.close();
    encodeGifFrame();
  },
  async finish() {
    gif.finish();
    return { gif: await toBase64(gif.bytes()) };
  },
};

window.webtape = studio;
