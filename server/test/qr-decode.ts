import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

// Load the ZXing wasm binary from node_modules instead of the default CDN so tests run offline.
const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
prepareZXingModule({
  overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
});

/** Flatten transparency onto white, as if printed on paper. */
function flatten(png: Buffer) {
  const img = PNG.sync.read(png);
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]! / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(img.data[i + c]! * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { data, width: img.width, height: img.height };
}

/**
 * Decode with ZXing (the engine behind most Android scanner apps). This is the realistic check for
 * whether phones will read a design.
 */
export async function decodePng(png: Buffer): Promise<string | null> {
  const { data, width, height } = flatten(png);
  const flat = new PNG({ width, height });
  flat.data = Buffer.from(data);
  const results = await readBarcodes(new Uint8Array(PNG.sync.write(flat)), { formats: ['QRCode'], tryHarder: false });
  return results.find((r) => r.isValid)?.text ?? null;
}
