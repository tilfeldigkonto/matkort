import type { Nutrition, BaseUnit } from '../types';

export interface ExtractedNutrition {
  values: Partial<Nutrition>;
  baseUnit?: BaseUnit;
  found: string[];
  rawText: string;
}

const numberPattern = /\d{1,5}(?:[.,]\d{1,3})?/g;

function firstValue(text: string): number | undefined {
  const matches = text.match(numberPattern);
  if (!matches?.length) return undefined;
  const value = Number(matches[0].replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

/** Regelbasert parser; bevisst konservativ. Brukeren bekrefter alltid verdiene. */
export function extractNutrition(rawText: string): ExtractedNutrition {
  const lines = rawText.split(/\r?\n/).map(s => s.trim().replace(/\s{2,}/g, ' ')).filter(Boolean);
  const values: Partial<Nutrition> = {};
  const found: string[] = [];
  let baseUnit: BaseUnit | undefined;
  const whole = rawText.toLowerCase();
  if (/per\s*100\s*ml|pr\.?\s*100\s*ml|100\s*ml/.test(whole)) baseUnit = 'ml';
  else if (/per\s*100\s*g\b|pr\.?\s*100\s*g\b|100\s*g\b/.test(whole)) baseUnit = 'g';

  const patterns: { key: keyof Nutrition; start: RegExp }[] = [
    { key: 'protein', start: /\b(?:protein|proteiner)\b/i },
    { key: 'carbs', start: /\b(?:karbohydrater|carbohydrates|carbohydrate|karbohydrat)\b/i },
    { key: 'fat', start: /\b(?:fett|fat|total\s+fat)\b/i },
    { key: 'fiber', start: /\b(?:kostfiber|fiber|fibre)\b/i },
    { key: 'salt', start: /\b(?:salt|sodium)\b/i }
  ];

  for (const line of lines) {
    const lc = line.toLowerCase();
    if (/\b(?:energi|energy)\b/.test(lc) && values.kcal === undefined) {
      const kcalMatch = lc.match(/(\d{1,5}(?:[.,]\d+)?)\s*kcal\b/);
      if (kcalMatch) values.kcal = Number(kcalMatch[1].replace(',', '.'));
      else {
        // Vanlig form: "Energi (kJ/kcal) 1400 / 334"
        const withoutLabel = lc.replace(/.*?\b(?:energi|energy)\b/, '').replace(/\b(?:kj|kcal|100\s*g|100\s*ml)\b/g, '');
        const ns = [...withoutLabel.matchAll(numberPattern)].map(m => Number(m[0].replace(',', '.')));
        if (ns.length >= 2 && ns[0] > ns[1] * 3) values.kcal = ns[1];
        else if (ns.length === 1 && /kcal/.test(lc)) values.kcal = ns[0];
        else if (ns.length === 1 && /\bkj\b/.test(lc)) values.kcal = ns[0] / 4.184;
      }
      if (values.kcal !== undefined) found.push('kcal');
    }

    for (const { key, start } of patterns) {
      if (values[key] !== undefined) continue;
      const match = start.exec(lc);
      if (!match) continue;
      // Ikke behandle "hvorav mettet fett" som hovedverdien for fett.
      if (key === 'fat' && /(mettede?|saturated)/.test(lc)) continue;
      // "hvorav sukkerarter" skal ikke erstatte karbohydratverdien.
      if (key === 'carbs' && /\b(?:sukker|sugar)\b/.test(lc)) continue;
      const remainder = lc.slice(match.index + match[0].length).replace(/^\s*\([^)]*\)/, '');
      const value = firstValue(remainder);
      if (value !== undefined) { values[key] = value; found.push(key); }
    }
  }
  return { values, baseUnit, found, rawText };
}

declare const __MATKORT_BASE__: string;

/** Samme opprinnelse som appen. Tesseract skal ikke falle tilbake til et CDN. */
function ocrAsset(path: string): string {
  const base = __MATKORT_BASE__.endsWith('/') ? __MATKORT_BASE__ : `${__MATKORT_BASE__}/`;
  return new URL(`${base}${path}`, window.location.href).href.replace(/\/$/, '');
}

export async function recognizeLabel(image: File, onProgress: (text: string, fraction?: number) => void): Promise<ExtractedNutrition> {
  const { createWorker } = await import('tesseract.js');
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    onProgress('Laster tekstgjenkjenning …');
    worker = await createWorker('nor', 1, {
      workerPath: ocrAsset('ocr/worker.min.js'),
      corePath: ocrAsset('ocr/core'),
      langPath: ocrAsset('ocr/lang'),
      workerBlobURL: false,
      gzip: true,
      logger: message => {
        if (message.status === 'recognizing text') onProgress('Leser etiketten …', message.progress);
        else if (message.status === 'loading language traineddata') onProgress('Laster norsk språkmodell …', message.progress);
      }
    });
    const { data } = await worker.recognize(image);
    return extractNutrition(data.text);
  } finally {
    if (worker) await worker.terminate();
  }
}
