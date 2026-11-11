import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrLine } from '../lib/ocrParser';

// All OCR files are served from this app (public/ocr) and precached by the service worker.
// Nothing is fetched from a CDN, and images never leave the device.
const base = new URL('./ocr/', document.baseURI).href;

const workers = new Map<string, Promise<Worker>>();
let progressCb: ((p: number) => void) | undefined;

function getWorker(langs: string[]): Promise<Worker> {
  const key = langs.join('+');
  let w = workers.get(key);
  if (!w) {
    w = createWorker(langs, OEM.LSTM_ONLY, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang/',
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text' && progressCb) progressCb(m.progress);
      },
    }).then(async (wk) => {
      await wk.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      return wk;
    });
    w.catch(() => workers.delete(key));
    workers.set(key, w);
  }
  return w;
}

export function getOcrWorker(onProgress?: (p: number) => void): Promise<Worker> {
  progressCb = onProgress;
  return getWorker(['heb', 'eng']);
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

interface BoxLine { text: string; confidence: number; y0: number; y1: number }

async function readLines(worker: Worker, canvas: HTMLCanvasElement): Promise<BoxLine[]> {
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines: BoxLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) lines.push({ text: line.text.trim(), confidence: line.confidence, y0: line.bbox.y0, y1: line.bbox.y1 });
    }
  }
  if (lines.length === 0 && data.text) {
    for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t.trim(), confidence: data.confidence, y0: 0, y1: 0 });
  }
  return lines;
}

/**
 * Reads a screenshot twice: a Hebrew pass for merchant names and a Latin-only pass that reads dates and
 * amounts reliably (the Hebrew model often garbles left-to-right numbers in table rows). Each Hebrew
 * line gets the Latin line that overlaps it most vertically as `numText`.
 */
export async function recognizeImage(file: Blob, onProgress?: (p: number) => void): Promise<OcrLine[]> {
  const canvas = await preprocess(file);
  progressCb = onProgress && ((p) => onProgress(p / 2));
  const heb = await readLines(await getWorker(['heb', 'eng']), canvas);
  progressCb = onProgress && ((p) => onProgress(0.5 + p / 2));
  let eng: BoxLine[] = [];
  try {
    eng = await readLines(await getWorker(['eng']), canvas);
  } catch {
    // The Latin pass only improves numbers; without it the Hebrew pass is used alone.
  }
  // One-to-one: each Latin line goes to the Hebrew line it overlaps most (at least half the shorter
  // line's height); a Hebrew line left without one is parsed from its own text only.
  const numFor = new Map<number, { text: string; overlap: number }>();
  for (const e of eng) {
    let bestI = -1;
    let bestOverlap = 0;
    heb.forEach((h, i) => {
      const overlap = Math.min(h.y1, e.y1) - Math.max(h.y0, e.y0);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestI = i;
      }
    });
    if (bestI < 0) continue;
    const h = heb[bestI];
    if (bestOverlap < Math.min(h.y1 - h.y0, e.y1 - e.y0) * 0.5) continue;
    const prev = numFor.get(bestI);
    if (!prev || prev.overlap < bestOverlap) numFor.set(bestI, { text: e.text, overlap: bestOverlap });
  }
  const merged: OcrLine[] = heb.map((h, i) => ({ text: h.text, confidence: h.confidence, numText: numFor.get(i)?.text }));
  return merged;
}
