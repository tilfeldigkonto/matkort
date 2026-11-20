import type { Nutrition, BaseUnit } from '../types';

export interface ExtractedNutrition {
  values: Partial<Nutrition>;
  baseUnit?: BaseUnit;
  found: string[];
  rawText: string;
}

type AmountKind = 'macro' | 'salt';

/** «g» leses ofte som 9, og desimalkomma forsvinner: «4,9 g» blir «499», «10,0 g» blir «1009». */
function amountCandidates(token: string, kind: AmountKind): number[] {
  const gluedUnit = /\dg\b/i.test(token);
  const clean = token.replace(/[^\d.,]/g, '');
  if (!/\d/.test(clean)) return [];
  const found = new Set<number>();
  const add = (value: number) => {
    if (Number.isFinite(value) && value >= 0 && value < 10000) found.add(Math.round(value * 1000) / 1000);
  };
  if (/[.,]/.test(clean)) {
    const normalized = clean.replace(',', '.');
    add(Number(normalized));
    const fraction = normalized.split('.')[1] ?? '';
    const strayGram = kind === 'salt' ? fraction.length > 2 : fraction.length > 1;
    if (!gluedUnit && strayGram && fraction.endsWith('9')) add(Number(normalized.slice(0, -1)));
    return [...found];
  }
  if (gluedUnit && clean.startsWith('0')) return [Number(`0.${clean.slice(1)}`)];
  add(Number(clean));
  if (gluedUnit && clean.length >= 2) add(Number(`${clean.slice(0, -1)}.${clean.slice(-1)}`));
  if (!gluedUnit && clean.endsWith('9') && clean.length >= 3) {
    const rest = clean.slice(0, -1);
    if (rest.startsWith('0')) add(Number(`0.${rest.slice(1)}`));
    else add(Number(`${rest.slice(0, -1)}.${rest.slice(-1)}`));
  }
  return [...found];
}

function tokensOf(text: string): string[] {
  return text.match(/\d[\d.,]*\s*g?\b/gi) ?? [];
}

/** To tall på linjen er per 100 g og per porsjon. Porsjonen er mindre når den er under 100 g. */
function per100FromTokens(tokens: string[], portion: number | undefined, kind: AmountKind): number | undefined {
  const lists = tokens.slice(0, 2).map(token => amountCandidates(token, kind)).filter(list => list.length);
  if (!lists.length) return undefined;
  if (lists.length === 1) {
    const plausible = lists[0].filter(value => value <= 100);
    return Math.min(...(plausible.length ? plausible : lists[0]));
  }
  const target = portion && portion !== 100 ? 100 / portion : undefined;
  let best: { value: number; score: number } | undefined;
  for (const left of lists[0]) {
    for (const right of lists[1]) {
      let score = left > 100 ? 100 : 0;
      if (target && right > 0) score += Math.abs(left / right - target);
      else score += 1;
      if (!best || score < best.score || (score === best.score && left < best.value)) best = { value: left, score };
    }
  }
  return best?.value;
}

function portionGrams(text: string): number | undefined {
  const amounts: number[] = [];
  for (const match of text.toLowerCase().matchAll(/per\s*(\d{2,4})/g)) {
    let amount = Number(match[1]);
    // «1009» er «100 g» der g ble lest som 9.
    if (amount > 100 && String(amount).endsWith('9')) amount = Number(String(amount).slice(0, -1));
    if (amount > 0 && amount !== 100 && amount < 500) amounts.push(amount);
  }
  return amounts[0];
}

function kcalFromLine(line: string, portion: number | undefined): number | undefined {
  const read = (unit: string) => [...line.matchAll(new RegExp(`(\\d{1,5}(?:[.,]\\d{1,3})?)\\s*${unit}\\b`, 'gi'))]
    .map(match => Number(match[1].replace(',', '.')))
    .filter(value => Number.isFinite(value));
  const choose = (values: number[]) => {
    if (!values.length) return undefined;
    // Ett tall ved siden av en mindre porsjonskolonne er ofte porsjonen, ikke per 100 g.
    if (values.length === 1) return portion !== undefined && portion < 100 ? undefined : values[0];
    if (portion === undefined) return values[0];
    return portion < 100 ? Math.max(...values) : Math.min(...values);
  };
  const kcal = choose(read('kcal'));
  if (kcal !== undefined) return kcal;
  const kj = choose(read('kj'));
  return kj === undefined ? undefined : kj / 4.184;
}

const nutrientPatterns: { key: keyof Nutrition; start: RegExp; kind: AmountKind; skip?: RegExp }[] = [
  { key: 'protein', kind: 'macro', start: /\b(?:protein\w*|proteiin\w*)\b/i },
  { key: 'carbs', kind: 'macro', start: /\b(?:karbohydrat\w*|carbohydrate\w*|kolhydrat\w*|hiilihydra\w*)\b/i, skip: /\b(?:sukker|sugar|socker|soker)\w*/i },
  { key: 'fat', kind: 'macro', start: /\b(?:fett|fat|rasva|total\s+fat)\b/i, skip: /mett|saturat|m[aä]ttat|tyydytty/i },
  { key: 'fiber', kind: 'macro', start: /\b(?:kostfibr\w*|ravintokuitu|kuitu|fiber|fibre)\b/i },
  { key: 'salt', kind: 'salt', start: /\b(?:salt|suola|sodium|natrium)\b/i }
];

function isAmountLine(line: string): boolean {
  const letters = line.replace(/[^a-zæøåäö]/gi, '');
  return letters.length <= 3 && tokensOf(line).length > 0;
}

/** Når kolonnenavnene ikke ble lest, følger radene EU-rekkefølgen etter energilinjen. */
function valuesFromRows(lines: string[], portion: number | undefined): Partial<Nutrition> {
  const energyAt = lines.findIndex(line => /kcal|\bkj\b/i.test(line));
  const rows = (energyAt >= 0 ? lines.slice(energyAt + 1) : lines).filter(isAmountLine).slice(0, 7);
  if (rows.length < 6) return {};
  const withFiber = rows.length >= 7;
  const keys: (keyof Nutrition | 'skip')[] = withFiber
    ? ['fat', 'skip', 'carbs', 'skip', 'fiber', 'protein', 'salt']
    : ['fat', 'skip', 'carbs', 'skip', 'protein', 'salt'];
  const values: Partial<Nutrition> = {};
  rows.forEach((row, index) => {
    const key = keys[index];
    if (!key || key === 'skip') return;
    const value = per100FromTokens(tokensOf(row), portion, key === 'salt' ? 'salt' : 'macro');
    if (value !== undefined) values[key] = value;
  });
  return values;
}

/** Regelbasert parser. Brukeren bekrefter alltid verdiene. */
export function extractNutrition(rawText: string): ExtractedNutrition {
  const lines = rawText.split(/\r?\n/).map(line => line.trim().replace(/\s{2,}/g, ' ')).filter(Boolean);
  const values: Partial<Nutrition> = {};
  const found: string[] = [];
  const whole = rawText.toLowerCase();
  const portion = portionGrams(whole);
  let baseUnit: BaseUnit | undefined;
  if (/100\s*ml\b/.test(whole)) baseUnit = 'ml';
  else if (/100\s*(?:g|gram)\b|per\s*100\s*9\b|per\s*1009\b/.test(whole)) baseUnit = 'g';

  const kcalLine = lines.find(line => /kcal/i.test(line)) ?? lines.find(line => /\d\s*kj\b|energi|energy|energia/i.test(line));
  if (kcalLine) {
    const kcal = kcalFromLine(kcalLine, portion);
    if (kcal !== undefined) { values.kcal = kcal; found.push('kcal'); }
  }

  for (const line of lines) {
    for (const nutrient of nutrientPatterns) {
      if (values[nutrient.key] !== undefined || !nutrient.start.test(line)) continue;
      if (nutrient.skip?.test(line)) continue;
      const value = per100FromTokens(tokensOf(line), portion, nutrient.kind);
      if (value !== undefined) { values[nutrient.key] = value; found.push(nutrient.key); }
    }
  }

  const named = ['fat', 'carbs', 'protein'].filter(key => values[key as keyof Nutrition] !== undefined).length;
  if (named < 2) {
    for (const [key, value] of Object.entries(valuesFromRows(lines, portion)) as [keyof Nutrition, number][]) {
      if (values[key] === undefined) { values[key] = value; found.push(key); }
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
  const { createWorker, PSM } = await import('tesseract.js');
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
    // Hele tabellen som én blokk, så 100 g-kolonnen ikke faller bort.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const { data } = await worker.recognize(image);
    return extractNutrition(data.text);
  } finally {
    if (worker) await worker.terminate();
  }
}
