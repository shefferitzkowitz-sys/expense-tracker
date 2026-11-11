// Copies Tesseract worker, WASM core and language data into public/ so OCR runs fully offline.
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/ocr';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', join(out, 'worker.min.js')],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']
    .map((f) => [`node_modules/tesseract.js-core/${f}`, join(out, 'core', f)]),
  ['node_modules/@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz', join(out, 'lang', 'heb.traineddata.gz')],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', join(out, 'lang', 'eng.traineddata.gz')],
];
for (const [from, to] of copies) {
  if (!existsSync(from)) { console.warn('missing OCR asset', from); continue; }
  copyFileSync(from, to);
}
console.log('OCR assets copied to', out);
