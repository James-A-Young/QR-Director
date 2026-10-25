import QRCode from 'qrcode';

export interface QrMatrix {
  /** Number of modules per side. */
  size: number;
  version: number;
  isDark(row: number, col: number): boolean;
}

export function buildMatrix(text: string, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel });
  const { size, data } = qr.modules;
  return {
    size,
    version: qr.version,
    isDark: (row, col) => row >= 0 && col >= 0 && row < size && col < size && data[row * size + col] === 1,
  };
}

export type EyePosition = 'top-left' | 'top-right' | 'bottom-left';

export function eyeOrigins(size: number): Array<{ position: EyePosition; row: number; col: number }> {
  return [
    { position: 'top-left', row: 0, col: 0 },
    { position: 'top-right', row: 0, col: size - 7 },
    { position: 'bottom-left', row: size - 7, col: 0 },
  ];
}

/** True for modules belonging to one of the three 7x7 finder patterns ("eyes"). */
export function isFinderModule(size: number, row: number, col: number): boolean {
  const inTop = row < 7;
  const inLeft = col < 7;
  const inRight = col >= size - 7;
  const inBottom = row >= size - 7;
  return (inTop && inLeft) || (inTop && inRight) || (inBottom && inLeft);
}

const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

/**
 * Prepare the text encoded in the QR symbol. Upper-casing a URL lets the encoder use the
 * alphanumeric mode, which is ~40% denser than byte mode and so yields a less busy code.
 * Only safe when every case-sensitive part of the URL (the short code) is case-insensitive.
 */
export function qrPayload(url: string, uppercase: boolean): string {
  if (!uppercase) return url;
  const upper = url.toUpperCase();
  return ALPHANUMERIC.test(upper) ? upper : url;
}
