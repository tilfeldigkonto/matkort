import type { Ingredient, Nutrition, Product, QuantityUnit, Recipe } from '../types';
import { ZERO_NUTRITION } from '../types';

export const addNutrition = (a: Nutrition, b: Nutrition): Nutrition => ({
  kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs,
  fat: a.fat + b.fat, fiber: a.fiber + b.fiber, salt: a.salt + b.salt
});

export const multiplyNutrition = (n: Nutrition, ratio: number): Nutrition => ({
  kcal: n.kcal * ratio, protein: n.protein * ratio, carbs: n.carbs * ratio,
  fat: n.fat * ratio, fiber: n.fiber * ratio, salt: n.salt * ratio
});

export function availableUnits(product: Product): QuantityUnit[] {
  const base: QuantityUnit[] = product.baseUnit === 'g' ? ['g', 'kg'] : ['ml', 'dl', 'l'];
  if (product.density && product.density > 0) {
    if (product.baseUnit === 'g') base.push('ml', 'dl', 'l');
    else base.push('g', 'kg');
  }
  if (product.pieceSize && product.pieceSize > 0) base.push('stk');
  return base;
}

/** Mengde oversatt til produktenes per-100-basis. null = uforenlig uten tetthet/stk-størrelse. */
export function toBaseAmount(product: Product, amount: number, unit: QuantityUnit): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (unit === 'stk') return product.pieceSize && product.pieceSize > 0 ? amount * product.pieceSize : null;
  if (product.baseUnit === 'g') {
    if (unit === 'g') return amount;
    if (unit === 'kg') return amount * 1000;
  } else {
    if (unit === 'ml') return amount;
    if (unit === 'dl') return amount * 100;
    if (unit === 'l') return amount * 1000;
  }
  if (!product.density || product.density <= 0) return null;
  const ml = unit === 'ml' ? amount : unit === 'dl' ? amount * 100 : unit === 'l' ? amount * 1000 : null;
  if (product.baseUnit === 'g' && ml !== null) return ml * product.density;
  const g = unit === 'g' ? amount : unit === 'kg' ? amount * 1000 : null;
  if (product.baseUnit === 'ml' && g !== null) return g / product.density;
  return null;
}

export function ingredientNutrition(ingredient: Ingredient, products: Product[]): Nutrition | null {
  const product = products.find(p => p.id === ingredient.productId);
  if (!product) return null;
  const baseAmount = toBaseAmount(product, ingredient.amount, ingredient.unit);
  if (baseAmount === null) return null;
  return multiplyNutrition(product.nutrition, baseAmount / 100);
}

export function recipeNutrition(recipe: Recipe, products: Product[]): { total: Nutrition; missing: number } {
  return recipe.ingredients.reduce((acc, ingredient) => {
    const nutrition = ingredientNutrition(ingredient, products);
    if (!nutrition) return { ...acc, missing: acc.missing + 1 };
    return { ...acc, total: addNutrition(acc.total, nutrition) };
  }, { total: { ...ZERO_NUTRITION }, missing: 0 });
}

export function formatNumber(n: number, maxDecimals = 1): string {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: maxDecimals }).format(n);
}

export function parseNumber(input: string): number {
  // støtter både norske komma og engelske punktum som desimalseparator
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return NaN;
  return Number(normalized);
}

export function cleanNutrition(n: Nutrition): Nutrition {
  return Object.fromEntries(
    (Object.keys(ZERO_NUTRITION) as (keyof Nutrition)[]).map(key => [key, Math.max(0, Number(n[key]) || 0)])
  ) as unknown as Nutrition;
}
