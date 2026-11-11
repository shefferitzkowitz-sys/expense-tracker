import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrLine } from '../lib/ocrParser';

// All OCR files are served from this app (public/ocr) and precached by the service worker.
// Nothing is fetched from a CDN, and images never leave the device.
const base = new URL('./ocr/', document.baseURI).href;

let workerPromise: Promise<Worker> | null = null;

export function getOcrWorker(onProgress?: (p: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['heb', 'eng'], OEM.LSTM_ONLY, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang/',
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      },
    }).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      return w;
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Upscales small screenshots and converts to grayscale for better OCR of small statement text. */
async function preprocess(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1400 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width * scale;
  canvas.height = bmp.height * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const dark = sum / (d.length / 4) < 110; // dark-mode screenshots: invert so text is dark on light
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (dark) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  bmp.close();
  return canvas;
}

export async function recognizeImage(file: Blob, onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const worker = await getOcrWorker(onProgress);
  const canvas = await preprocess(file);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) lines.push({ text: line.text.trim(), confidence: line.confidence });
    }
  }
  if (lines.length === 0 && data.text) {
    for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t.trim(), confidence: data.confidence });
  }
  return lines;
}
