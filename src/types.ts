export type BaseUnit = 'g' | 'ml';
export type QuantityUnit = 'g' | 'kg' | 'ml' | 'dl' | 'l' | 'stk';
export type Nutrition = { kcal: number; protein: number; carbs: number; fat: number; fiber: number; salt: number };

export interface Product {
  id: string;
  name: string;
  baseUnit: BaseUnit; // Næringsinnhold per 100 g eller 100 ml
  nutrition: Nutrition;
  density?: number; // g/ml: bare nødvendig ved omregning mellom vekt og volum
  pieceSize?: number; // g eller ml per stk (samme enhet som baseUnit)
  createdAt: number;
  updatedAt: number;
}

export interface Ingredient {
  id: string;
  productId: string;
  amount: number;
  unit: QuantityUnit;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  portions: number;
  createdAt: number;
  updatedAt: number;
}

export const ZERO_NUTRITION: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 };
export const DEFAULT_NUTRITION = (): Nutrition => ({ ...ZERO_NUTRITION });
