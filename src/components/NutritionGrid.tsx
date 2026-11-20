import type { Nutrition } from '../types';
import { formatNumber } from '../lib/nutrition';

type Props = { nutrition: Nutrition; compact?: boolean; label?: string };
export default function NutritionGrid({ nutrition, compact, label }: Props) {
  return <div className={'nutrition-card ' + (compact ? 'nutrition-card--compact' : '')}>
    {label && <div className="nutrition-label">{label}</div>}
    <div className="nutrition-grid">
      <div className="nutrition-metric nutrition-metric--main"><strong>{formatNumber(nutrition.kcal, 0)}</strong><span>kcal</span></div>
      <div className="nutrition-metric"><strong>{formatNumber(nutrition.protein)} <small>g</small></strong><span>Protein</span></div>
      <div className="nutrition-metric"><strong>{formatNumber(nutrition.carbs)} <small>g</small></strong><span>Karbohydrater</span></div>
      <div className="nutrition-metric"><strong>{formatNumber(nutrition.fat)} <small>g</small></strong><span>Fett</span></div>
    </div>
    {!compact && <div className="nutrition-extra">Fiber: {formatNumber(nutrition.fiber)} g <span>•</span> Salt: {formatNumber(nutrition.salt, 2)} g</div>}
  </div>;
}
