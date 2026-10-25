import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { crc32 } from 'node:zlib';

export const MAX_PNG_DIMENSION = 8000;
/** Total pixel budget (width × height, frames included): ~50 cm square at 300 dpi. */
export const MAX_PNG_PIXELS = 36_000_000;
/** Rasterising workers per instance; each render can use a few hundred MB. */
const POOL_SIZE = 2;
/** Idle workers exit so memory is released between bursts of exports. */
const IDLE_MS = 30_000;

// Rasterising and PNG encoding are CPU heavy and synchronous, so they run in worker threads to keep
// the event loop (and with it every redirect) responsive. The worker is plain JS so it runs the same
// under tsx, vitest and the compiled build.
const RESVG_PATH = createRequire(import.meta.url).resolve('@resvg/resvg-js');
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { Resvg } = require(workerData.resvgPath);
parentPort.on('message', ({ id, svg, width }) => {
  try {
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { loadSystemFonts: false },
      imageRendering: 0,
      shapeRendering: 2,
    }).render().asPng();
    parentPort.postMessage({ id, png });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err && err.message || err) });
  }
});
`;

interface Job {
  svg: string;
  width: number;
  resolve: (png: Buffer) => void;
  reject: (err: Error) => void;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  idleTimer?: NodeJS.Timeout;
}

const workers: PoolWorker[] = [];
const queue: Job[] = [];
let nextId = 0;

function spawn(): PoolWorker {
  const pw: PoolWorker = {
    worker: new Worker(WORKER_SOURCE, { eval: true, workerData: { resvgPath: RESVG_PATH } }),
    busy: false,
  };
  pw.worker.unref();
  pw.worker.on('error', () => retire(pw));
  pw.worker.on('exit', () => retire(pw));
  workers.push(pw);
  return pw;
}

function retire(pw: PoolWorker) {
  const i = workers.indexOf(pw);
  if (i >= 0) workers.splice(i, 1);
  clearTimeout(pw.idleTimer);
}

function dispatch() {
  while (queue.length > 0) {
    const pw = workers.find((w) => !w.busy) ?? (workers.length < POOL_SIZE ? spawn() : undefined);
    if (!pw) return;
    const job = queue.shift()!;
    const id = nextId++;
    pw.busy = true;
    clearTimeout(pw.idleTimer);
    const onMessage = (msg: { id: number; png?: Uint8Array; error?: string }) => {
      if (msg.id !== id) return;
      cleanup();
      if (msg.png) job.resolve(Buffer.from(msg.png.buffer, msg.png.byteOffset, msg.png.byteLength));
      else job.reject(new Error(msg.error ?? 'PNG rendering failed'));
    };
    const onExit = () => {
      cleanup();
      job.reject(new Error('PNG renderer exited unexpectedly'));
    };
    const cleanup = () => {
      pw.worker.off('message', onMessage);
      pw.worker.off('exit', onExit);
      pw.busy = false;
      pw.idleTimer = setTimeout(() => void pw.worker.terminate(), IDLE_MS);
      pw.idleTimer.unref();
      dispatch();
    };
    pw.worker.on('message', onMessage);
    pw.worker.on('exit', onExit);
    pw.worker.postMessage({ id, svg: job.svg, width: job.width });
  }
}

/** Rasterise an SVG to PNG at an exact pixel width, embedding DPI metadata so print tools size it correctly. */
export async function svgToPng(svg: string, widthPx: number, dpi = 300): Promise<Buffer> {
  const width = Math.max(16, Math.min(MAX_PNG_DIMENSION, Math.round(widthPx)));
  const png = await new Promise<Buffer>((resolve, reject) => {
    queue.push({ svg, width, resolve, reject });
    dispatch();
  });
  return withDpi(png, dpi);
}

/** Insert (or replace) a pHYs chunk declaring the image resolution. */
export function withDpi(png: Buffer, dpi: number): Buffer {
  const signatureLength = 8;
  const ihdrEnd = signatureLength + 8 + png.readUInt32BE(signatureLength) + 4;
  const pixelsPerMetre = Math.round(dpi / 0.0254);

  const data = Buffer.alloc(9);
  data.writeUInt32BE(pixelsPerMetre, 0);
  data.writeUInt32BE(pixelsPerMetre, 4);
  data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from('pHYs', 'ascii');
  const chunk = Buffer.alloc(4 + 4 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 8 + data.length);

  // Strip any existing pHYs chunk.
  const chunks: Buffer[] = [png.subarray(0, ihdrEnd), chunk];
  let offset = ihdrEnd;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const end = offset + 12 + len;
    if (png.toString('ascii', offset + 4, offset + 8) !== 'pHYs') chunks.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}
