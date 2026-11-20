import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import type { Product, Recipe } from '../types';

interface MatkortSchema extends DBSchema {
  products: { key: string; value: Product };
  recipes: { key: string; value: Recipe };
}

const database = openDB<MatkortSchema>('matkort-v1', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
  }
});

export async function loadData() {
  const db = await database;
  const [products, recipes] = await Promise.all([db.getAll('products'), db.getAll('recipes')]);
  return { products: products.sort((a,b) => a.name.localeCompare(b.name, 'nb')), recipes: recipes.sort((a,b) => b.updatedAt - a.updatedAt) };
}

export async function saveProduct(product: Product) { await (await database).put('products', product); }
export async function saveRecipe(recipe: Recipe) { await (await database).put('recipes', recipe); }
export async function removeProduct(id: string) { await (await database).delete('products', id); }
export async function removeRecipe(id: string) { await (await database).delete('recipes', id); }

export interface Backup { format: 'matkort-backup'; version: 1; exportedAt: string; products: Product[]; recipes: Recipe[] }
export function makeBackup(products: Product[], recipes: Recipe[]): Backup { return { format: 'matkort-backup', version: 1, exportedAt: new Date().toISOString(), products, recipes }; }

export function validateBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw Error('Ugyldig JSON-fil.');
  const obj = value as Record<string, unknown>;
  if (obj.format !== 'matkort-backup' || obj.version !== 1 || !Array.isArray(obj.products) || !Array.isArray(obj.recipes)) throw Error('Dette er ikke en Matkort-sikkerhetskopi.');
  const ids = new Set<string>();
  for (const p of obj.products) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !['g','ml'].includes(p.baseUnit) || !p.nutrition) throw Error('Ugyldig produkt i sikkerhetskopien.');
    for (const n of ['kcal','protein','carbs','fat','fiber','salt']) if (typeof p.nutrition[n] !== 'number' || !Number.isFinite(p.nutrition[n]) || p.nutrition[n] < 0) throw Error('Ugyldig næringsinnhold i sikkerhetskopien.');
    if (ids.has(p.id)) throw Error('Duplisert produkt-ID.');
    ids.add(p.id);
  }
  const recipeIds = new Set<string>();
  for (const r of obj.recipes) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !Number.isInteger(r.portions) || r.portions < 1 || !Array.isArray(r.ingredients)) throw Error('Ugyldig rett i sikkerhetskopien.');
    if (recipeIds.has(r.id)) throw Error('Duplisert rett-ID.');
    recipeIds.add(r.id);
    for (const i of r.ingredients) if (!i || typeof i.id !== 'string' || typeof i.productId !== 'string' || !Number.isFinite(i.amount) || i.amount <= 0 || !['g','kg','ml','dl','l','stk'].includes(i.unit)) throw Error('Ugyldig ingrediens i sikkerhetskopien.');
  }
  return value as Backup;
}

export async function restoreBackup(backup: Backup) {
  const db = await database;
  const tx = db.transaction(['products', 'recipes'], 'readwrite');
  await Promise.all([tx.objectStore('products').clear(), tx.objectStore('recipes').clear()]);
  for (const p of backup.products) await tx.objectStore('products').put(p);
  for (const r of backup.recipes) await tx.objectStore('recipes').put(r);
  await tx.done;
}

export async function wipeData() {
  const db = await database;
  const tx = db.transaction(['products','recipes'], 'readwrite');
  await Promise.all([tx.objectStore('products').clear(), tx.objectStore('recipes').clear()]);
  await tx.done;
}
