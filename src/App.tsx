import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import {
  ArrowLeft, BookOpenText, Camera, Check, ChevronRight, Copy, Download,
  FileImage, Info, Leaf, Menu, Plus, ScanLine, Search, Settings2,
  ShoppingBasket, Sparkles, Trash2, Upload, X
} from 'lucide-react';
import type { Ingredient, Nutrition, Product, QuantityUnit, Recipe } from './types';
import { DEFAULT_NUTRITION } from './types';
import { availableUnits, formatNumber, ingredientNutrition, multiplyNutrition, parseNumber, recipeNutrition, toBaseAmount } from './lib/nutrition';
import { extractNutrition, recognizeLabel } from './lib/ocr';
import { loadData, makeBackup, removeProduct, removeRecipe, restoreBackup, saveProduct, saveRecipe, validateBackup, wipeData } from './lib/db';
import NutritionGrid from './components/NutritionGrid';
import { version } from '../package.json';

type View = 'recipes' | 'products' | 'settings';
type Metric = keyof Nutrition;
const metricLabels: { key: Metric; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Energi', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Karbohydrater', unit: 'g' },
  { key: 'fat', label: 'Fett', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' }
];

function newId(): string { return crypto.randomUUID(); }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : 'Noe gikk galt.'; }
function noteDate(date: number): string { return new Date(date).toLocaleDateString('nb-NO', { day:'numeric', month:'short', year:'numeric' }); }

function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button'|'submit'; className?: string;
}) { return <button className={`btn btn--${variant} ${className}`} type={type} onClick={onClick} disabled={disabled}>{children}</button>; }
function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
function EmptyState({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{children}</div>;
}

function ProductEditor({ initial, onCancel, onSave }: { initial: Product | null; onCancel: () => void; onSave: (product: Product) => Promise<void> }) {
  const [name, setName] = useState(initial?.name || '');
  const [baseUnit, setBaseUnit] = useState<'g'|'ml'>(initial?.baseUnit || 'g');
  const [nutrition, setNutrition] = useState<Record<Metric, string>>(() => {
    const source = initial?.nutrition || DEFAULT_NUTRITION();
    return { kcal: String(source.kcal), protein: String(source.protein), carbs: String(source.carbs), fat: String(source.fat), fiber: String(source.fiber), salt: String(source.salt) };
  });
  const [density, setDensity] = useState(initial?.density ? String(initial.density) : '');
  const [pieceSize, setPieceSize] = useState(initial?.pieceSize ? String(initial.pieceSize) : '');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ocrMessage, setOcrMessage] = useState('');
  const [ocrProgress, setOcrProgress] = useState<number | undefined>();
  const [ocrRaw, setOcrRaw] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const imageRef = useRef('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (imageRef.current) URL.revokeObjectURL(imageRef.current); }, []);

  const onImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Velg en bildefil.'); return; }
    if (imageRef.current) URL.revokeObjectURL(imageRef.current);
    imageRef.current = URL.createObjectURL(file);
    setImageUrl(imageRef.current);
    setBusy(true); setError(''); setOcrMessage('Klargjør bildet …'); setOcrProgress(undefined);
    try {
      const result = await recognizeLabel(file, (message, progress) => { setOcrMessage(message); setOcrProgress(progress); });
      setOcrRaw(result.rawText);
      if (result.baseUnit) setBaseUnit(result.baseUnit);
      setNutrition(old => ({ ...old, ...Object.fromEntries(Object.entries(result.values).map(([k,v]) => [k, String(Number(v?.toFixed(2)))])) }));
      setOcrMessage(result.found.length ? `Fant ${result.found.length} næringsverdier. Kontroller tallene under før lagring.` : 'Fant ingen sikre verdier. Fyll inn tallene manuelt, eller prøv et tydeligere bilde.');
    } catch (e) { setError(`Klarte ikke å lese bildet: ${getErrorMessage(e)}. Du kan fylle inn manuelt.`); setOcrMessage(''); }
    finally { setBusy(false); setOcrProgress(undefined); }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('Skriv inn produktnavn.'); return; }
    const parsed = {} as Nutrition;
    for (const {key, label} of metricLabels) {
      const value = parseNumber(nutrition[key]);
      if (!Number.isFinite(value) || value < 0) { setError(`Ugyldig verdi for ${label.toLowerCase()}.`); return; }
      parsed[key] = value;
    }
    const d = density.trim() ? parseNumber(density) : undefined;
    const p = pieceSize.trim() ? parseNumber(pieceSize) : undefined;
    if (d !== undefined && !(d > 0)) { setError('Tetthet må være større enn 0.'); return; }
    if (p !== undefined && !(p > 0)) { setError('Mengde per stykk må være større enn 0.'); return; }
    const now = Date.now();
    const product: Product = { id: initial?.id || newId(), name: name.trim(), baseUnit, nutrition: parsed, density: d, pieceSize: p, createdAt: initial?.createdAt || now, updatedAt: now };
    setSaving(true);
    try { await onSave(product); } catch (e) { setError(getErrorMessage(e)); } finally { setSaving(false); }
  }

  return <div className="editor-screen">
    <div className="back-row"><button className="icon-button" onClick={onCancel} aria-label="Tilbake"><ArrowLeft size={21}/></button><span>{initial ? 'Rediger produkt' : 'Nytt produkt'}</span></div>
    <SectionHeader eyebrow="PRODUKTBIBLIOTEK" title={initial ? 'Rediger matvare' : 'Legg til matvare'} description="Scan næringsdeklarasjonen, eller skriv inn tallene selv." />
    <section className="scan-panel">
      <div className="scan-icon"><ScanLine size={27}/></div>
      <div className="scan-content"><h3>Scan næringsinnhold</h3><p>Les næringstabellen fra et bilde. Ingen bilder lastes opp.</p>
        <div className="scan-actions">
          <Button variant="primary" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera size={16}/> Ta bilde</Button>
          <Button variant="outline" onClick={() => uploadRef.current?.click()} disabled={busy}><FileImage size={16}/> Velg bilde</Button>
        </div>
      </div>
      <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={onImageSelected}/>
      <input ref={uploadRef} className="sr-only" type="file" accept="image/*" onChange={onImageSelected}/>
    </section>
    {imageUrl && <div className="image-preview"><img src={imageUrl} alt="Valgt næringsdeklarasjon"/></div>}
    {ocrMessage && <div className="notice notice--success"><Info size={17}/><div>{ocrMessage}{busy && ocrProgress !== undefined && <div className="progress-track"><div style={{width:`${Math.round(ocrProgress * 100)}%`}}/></div>}</div></div>}
    {ocrRaw && <details className="raw-text"><summary>Vis tekst OCR leste</summary><pre>{ocrRaw}</pre><button type="button" className="text-button" onClick={() => { const result = extractNutrition(ocrRaw); setNutrition(old => ({...old, ...Object.fromEntries(Object.entries(result.values).map(([k,v]) => [k,String(v)]))})); }}>Prøv å fylle inn igjen</button></details>}
    <form onSubmit={submit} className="form-stack">
      <div className="field"><label htmlFor="product-name">Produktnavn <span>*</span></label><input id="product-name" autoComplete="off" value={name} placeholder="F.eks. Lettmelk" onChange={e=>setName(e.target.value)} required/></div>
      <div className="field"><label htmlFor="base-unit">Næringsinnhold oppgitt per</label><select id="base-unit" value={baseUnit} onChange={e=>setBaseUnit(e.target.value as 'g'|'ml')}><option value="g">100 gram (g)</option><option value="ml">100 milliliter (ml)</option></select></div>
      <div className="card flat-card">
        <h3 className="form-subheading">Næringsverdier per 100 {baseUnit}</h3>
        <p className="hint">Kontroller tallene fra bildet. Bruk komma eller punktum som desimaltegn.</p>
        <div className="metric-input-grid">{metricLabels.map(({key,label,unit}) => <div className="field" key={key}><label htmlFor={`metric-${key}`}>{label} <small>({unit})</small></label><input id={`metric-${key}`} type="text" inputMode="decimal" value={nutrition[key]} onChange={e=>setNutrition(old=>({...old,[key]:e.target.value}))}/></div>)}</div>
      </div>
      <details className="advanced-options"><summary>Valgfrie måleenheter (dl og stk)</summary><div className="advanced-inner">
        <p>Hvis du vil måle et produkt oppgitt per 100 g i dl, oppgi tetthet. 1 dl = 100 ml. For varer målt i stk, oppgi vekt eller volum per stykk.</p>
        <div className="field"><label htmlFor="density">Tetthet (g per ml)</label><input id="density" type="text" inputMode="decimal" placeholder="F.eks. 0,6 for enkelte meltyper" value={density} onChange={e=>setDensity(e.target.value)}/></div>
        <div className="field"><label htmlFor="piece-size">Mengde per stk ({baseUnit})</label><input id="piece-size" type="text" inputMode="decimal" placeholder={`F.eks. 55 ${baseUnit}`} value={pieceSize} onChange={e=>setPieceSize(e.target.value)}/></div>
      </div></details>
      {error && <div className="notice notice--error"><Info size={17}/>{error}</div>}
      <div className="form-actions"><Button type="submit" disabled={saving || busy}><Check size={18}/>{saving ? 'Lagrer …' : 'Lagre produkt'}</Button><Button variant="outline" onClick={onCancel}>Avbryt</Button></div>
    </form>
  </div>;
}

type IngredientDraft = {id: string; productId: string; amount: string; unit: QuantityUnit};
function draftFromIngredient(i: Ingredient): IngredientDraft { return { ...i, amount: String(i.amount) }; }
function RecipeEditor({ initial, products, onSave, onCancel, onAddProduct }: {
  initial: Recipe | null; products: Product[]; onSave: (recipe: Recipe) => Promise<void>; onCancel: () => void; onAddProduct: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [portions, setPortions] = useState(String(initial?.portions || 2));
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() => initial?.ingredients.map(draftFromIngredient) || []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const previewRecipe: Recipe = {
    id: initial?.id || '', name, portions: Math.max(1, Number(portions) || 1), createdAt: 0, updatedAt: 0,
    ingredients: ingredients.map(i=>({id:i.id,productId:i.productId,amount:parseNumber(i.amount),unit:i.unit}))
  };
  const {total, missing} = recipeNutrition(previewRecipe, products);

  function addIngredient() {
    const first = products[0];
    if (!first) return;
    setIngredients(old=>[...old,{id:newId(),productId:first.id,amount:'100',unit:first.baseUnit}]);
  }
  function updateIngredient(id: string, updates: Partial<IngredientDraft>) { setIngredients(old=>old.map(i=>i.id===id ? {...i,...updates} : i)); }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!name.trim()) { setError('Gi retten et navn.'); return; }
    const count = Number(portions);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) { setError('Antall porsjoner må være et heltall fra 1 til 1000.'); return; }
    if (!ingredients.length) { setError('Legg til minst én ingrediens.'); return; }
    const saved: Ingredient[] = [];
    for (const i of ingredients) {
      const product = products.find(p=>p.id===i.productId);
      const amount = parseNumber(i.amount);
      if (!product || !(amount > 0) || !Number.isFinite(amount) || toBaseAmount(product, amount, i.unit) === null) { setError('Kontroller ingrediensene og mengdene.'); return; }
      saved.push({ id:i.id, productId:i.productId, amount, unit:i.unit });
    }
    const now = Date.now();
    setSaving(true);
    try { await onSave({id:initial?.id || newId(),name:name.trim(),portions:count,ingredients:saved,createdAt:initial?.createdAt || now,updatedAt:now}); }
    catch(e) { setError(getErrorMessage(e)); } finally { setSaving(false); }
  }
  return <div className="editor-screen">
    <div className="back-row"><button className="icon-button" onClick={onCancel} aria-label="Tilbake"><ArrowLeft size={21}/></button><span>{initial ? 'Rediger rett' : 'Ny rett'}</span></div>
    <SectionHeader eyebrow="OPPSKRIFTER" title={initial ? 'Rediger retten' : 'Sett sammen en rett'} description="Velg produktene du har lagret, og oppgi hvor mye du bruker." />
    <form className="form-stack" onSubmit={submit}>
      <div className="field"><label htmlFor="recipe-name">Navn på retten <span>*</span></label><input id="recipe-name" value={name} onChange={e=>setName(e.target.value)} placeholder="F.eks. Pannekaker" required/></div>
      <div className="field portions-field"><label htmlFor="recipe-portions">Antall porsjoner</label><input id="recipe-portions" type="number" inputMode="numeric" min={1} max={1000} value={portions} onChange={e=>setPortions(e.target.value)}/><p className="hint">Gir næringsinnhold for hele retten og per porsjon.</p></div>
      <div className="ingredient-head"><h3>Ingredienser <span className="counter">{ingredients.length}</span></h3></div>
      {ingredients.length === 0 && <div className="small-empty">Ingen ingredienser enda. Legg til noe fra produktene dine.</div>}
      {ingredients.map((ing, index) => {
        const p = products.find(p=>p.id===ing.productId);
        const rowN = ingredientNutrition({ ...ing, amount:parseNumber(ing.amount) }, products);
        return <div className="ingredient-card" key={ing.id}>
          <div className="ingredient-index">{index+1}</div>
          <div className="ingredient-body">
            <div className="ingredient-top"><select aria-label={`Produkt ${index+1}`} value={ing.productId} onChange={e=>{
              const prod = products.find(p=>p.id===e.target.value);
              if(prod) updateIngredient(ing.id,{productId:prod.id,unit:prod.baseUnit});
            }}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button type="button" className="icon-button muted" onClick={()=>setIngredients(old=>old.filter(i=>i.id!==ing.id))} aria-label={`Fjern ingrediens ${index+1}`}><Trash2 size={18}/></button>
            </div>
            <div className="ingredient-bottom"><div className="amount-group"><input aria-label={`Mengde ${index+1}`} type="text" inputMode="decimal" value={ing.amount} onChange={e=>updateIngredient(ing.id,{amount:e.target.value})}/>
                <select aria-label={`Enhet ${index+1}`} value={ing.unit} onChange={e=>updateIngredient(ing.id,{unit:e.target.value as QuantityUnit})}>{(p ? availableUnits(p) : [ing.unit]).map(u=><option key={u} value={u}>{u}</option>)}</select></div>
              <span className="ingredient-calories">{rowN && Number.isFinite(rowN.kcal) ? formatNumber(rowN.kcal,0)+' kcal' : '—'}</span></div>
          </div>
        </div>;
      })}
      <div className="add-ingredient-row"><Button variant="outline" onClick={addIngredient} disabled={!products.length}><Plus size={18}/> Legg til ingrediens</Button><button type="button" className="text-button" onClick={onAddProduct}>+ Nytt produkt</button></div>
      {ingredients.length > 0 && <div className="summary-box"><NutritionGrid nutrition={total} label="Hele retten"/><div className="portion-result"><div><span>Per porsjon</span><strong>{formatNumber(total.kcal / (Math.max(1, Number(portions)||1)), 0)} kcal</strong></div><span>{formatNumber(total.protein / Math.max(1,Number(portions)||1))} g protein</span></div>{missing > 0 && <div className="notice notice--error"><Info size={15}/> {missing} ingrediens(er) kunne ikke beregnes. Sjekk mengdene.</div>}</div>}
      {error && <div className="notice notice--error"><Info size={17}/>{error}</div>}
      <div className="form-actions"><Button type="submit" disabled={saving || !products.length}><Check size={18}/> {saving ? 'Lagrer …' : 'Lagre rett'}</Button><Button variant="outline" onClick={onCancel}>Avbryt</Button></div>
    </form>
  </div>;
}

function RecipeDetails({ recipe, products, onBack, onEdit, onDelete, onDuplicate }: {
  recipe: Recipe; products: Product[]; onBack:()=>void; onEdit:()=>void; onDelete:()=>void; onDuplicate:()=>void;
}) {
  const {total, missing} = recipeNutrition(recipe,products);
  const perPortion = multiplyNutrition(total,1/Math.max(recipe.portions,1));
  return <div className="details-screen"><div className="back-row"><button className="icon-button" onClick={onBack} aria-label="Tilbake"><ArrowLeft size={21}/></button><span>Lagret rett</span></div>
    <div className="recipe-title-block"><div className="recipe-big-icon"><BookOpenText size={27}/></div><div className="eyebrow">{recipe.portions} {recipe.portions===1?'PORSJON':'PORSJONER'}</div><h2>{recipe.name}</h2><p>Oppdatert {noteDate(recipe.updatedAt)}</p></div>
    {missing > 0 && <div className="notice notice--error"><Info size={17}/>{missing} ingrediens(er) mangler eller har ugyldig enhet. Totalen er ufullstendig.</div>}
    <NutritionGrid nutrition={total} label="Hele retten"/>
    <div className="per-portion-section"><NutritionGrid nutrition={perPortion} label="Per porsjon" compact/></div>
    <div className="detail-ingredients"><h3>Ingredienser <span className="counter">{recipe.ingredients.length}</span></h3><div className="detail-rows">
      {recipe.ingredients.map(i => { const product = products.find(p=>p.id===i.productId); const n = ingredientNutrition(i,products);
        return <div className="detail-ingredient" key={i.id}><div><strong>{product?.name || 'Slettet produkt'}</strong><span>{formatNumber(i.amount,2)} {i.unit}</span></div><div className="detail-values"><strong>{n ? formatNumber(n.kcal,0)+' kcal' : '—'}</strong><span>{n ? formatNumber(n.protein)+' g protein' : 'Kan ikke beregnes'}</span></div></div>;
      })}
    </div></div>
    <div className="form-actions"><Button onClick={onEdit}>Rediger rett</Button><Button variant="outline" onClick={onDuplicate}><Copy size={17}/> Dupliser</Button><Button variant="danger" onClick={onDelete}><Trash2 size={17}/> Slett</Button></div>
  </div>;
}

function App() {
  const [tab, setTab] = useState<View>('recipes');
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [productEditor, setProductEditor] = useState<Product | 'new' | null>(null);
  const [recipeEditor, setRecipeEditor] = useState<Recipe | 'new' | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  async function refresh() { const data = await loadData(); setProducts(data.products); setRecipes(data.recipes); }
  useEffect(() => { refresh().catch(e=>setError(getErrorMessage(e))).finally(()=>setLoading(false)); }, []);
  const selectedRecipe = recipes.find(r=>r.id===selectedRecipeId);
  const filteredProducts = useMemo(()=>products.filter(p=>p.name.toLocaleLowerCase('nb').includes(search.toLocaleLowerCase('nb'))),[products,search]);
  const filteredRecipes = useMemo(()=>recipes.filter(r=>r.name.toLocaleLowerCase('nb').includes(search.toLocaleLowerCase('nb'))),[recipes,search]);

  function switchTab(next: View) { setTab(next); setSearch(''); setProductEditor(null); setRecipeEditor(null); setSelectedRecipeId(null); setError(''); }
  function startProduct(initial: Product | 'new' = 'new') { setTab('products'); setRecipeEditor(null); setSelectedRecipeId(null); setProductEditor(initial); setError(''); window.scrollTo({top:0,behavior:'smooth'}); }
  function startRecipe(initial: Recipe | 'new' = 'new') { setTab('recipes'); setProductEditor(null); setSelectedRecipeId(null); setRecipeEditor(initial); setError(''); window.scrollTo({top:0,behavior:'smooth'}); }
  async function persistProduct(p: Product) { await saveProduct(p); await refresh(); setProductEditor(null); setToast('Produkt lagret.'); }
  async function persistRecipe(r: Recipe) { await saveRecipe(r); await refresh(); setRecipeEditor(null); setSelectedRecipeId(r.id); setToast('Retten er lagret.'); }
  async function deleteProduct(product: Product) {
    const usedBy = recipes.filter(r=>r.ingredients.some(i=>i.productId===product.id));
    if (usedBy.length) { setError(`«${product.name}» brukes i ${usedBy.length} rett(er). Fjern ingrediensen der først.`); return; }
    if (!window.confirm(`Slette «${product.name}»?`)) return;
    try { await removeProduct(product.id); await refresh(); setToast('Produkt slettet.'); } catch(e) {setError(getErrorMessage(e));}
  }
  async function deleteRecipe(recipe: Recipe) {
    if (!window.confirm(`Slette retten «${recipe.name}»?`)) return;
    try { await removeRecipe(recipe.id); await refresh(); setSelectedRecipeId(null); setToast('Rett slettet.'); } catch(e) {setError(getErrorMessage(e));}
  }
  async function duplicateRecipe(recipe: Recipe) {
    const now = Date.now();
    const duplicate: Recipe = { ...recipe, id:newId(), name:`${recipe.name} (kopi)`, ingredients:recipe.ingredients.map(i=>({...i,id:newId()})), createdAt:now,updatedAt:now };
    try { await persistRecipe(duplicate); } catch(e) {setError(getErrorMessage(e));}
  }
  function exportData() {
    const json = JSON.stringify(makeBackup(products,recipes),null,2);
    const blob = new Blob([json],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`matkort-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
    setToast('Sikkerhetskopi opprettet. Lagre filen på et trygt sted.');
  }
  async function importData(e:ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value=''; if(!file)return;
    try {
      if (file.size > 5_000_000) throw new Error('Filen er for stor.');
      const backup = validateBackup(JSON.parse(await file.text()));
      if (!window.confirm(`Importere ${backup.products.length} produkter og ${backup.recipes.length} retter? Dette vil erstatte alle eksisterende data.`)) return;
      await restoreBackup(backup); await refresh(); setToast('Sikkerhetskopi importert.'); switchTab('recipes');
    } catch(err) {setError(getErrorMessage(err));}
  }
  async function loadExamples() {
    if (products.length || recipes.length) { setError('Eksempeldata kan bare legges inn når biblioteket er tomt.'); return; }
    const now=Date.now(), flour=newId(), milk=newId(), egg=newId();
    const examples: Product[] = [
      {id:flour,name:'Hvetemel (eksempel)',baseUnit:'g',nutrition:{kcal:340,protein:11,carbs:70,fat:1.5,fiber:3,salt:0},density:0.6,createdAt:now,updatedAt:now},
      {id:milk,name:'Lettmelk (eksempel)',baseUnit:'ml',nutrition:{kcal:47,protein:3.5,carbs:4.7,fat:1.5,fiber:0,salt:0.1},createdAt:now,updatedAt:now},
      {id:egg,name:'Egg (eksempel)',baseUnit:'g',nutrition:{kcal:143,protein:13,carbs:0.7,fat:10,fiber:0,salt:0.3},pieceSize:55,createdAt:now,updatedAt:now}
    ];
    const recipe: Recipe={id:newId(),name:'Pannekaker (eksempel)',portions:3,ingredients:[{id:newId(),productId:flour,amount:125,unit:'g'},{id:newId(),productId:milk,amount:3,unit:'dl'},{id:newId(),productId:egg,amount:2,unit:'stk'}],createdAt:now,updatedAt:now};
    try { for (const p of examples) await saveProduct(p); await saveRecipe(recipe); await refresh(); switchTab('recipes'); setToast('Eksempeldata lagt inn.'); } catch(err){setError(getErrorMessage(err));}
  }
  async function clearAll() {
    if(!window.confirm('Dette sletter ALLE produkter og retter fra denne enheten. Har du tatt sikkerhetskopi?')) return;
    if(!window.confirm('Siste bekreftelse: slett alt?')) return;
    try { await wipeData(); await refresh(); switchTab('recipes'); setToast('Alle data er slettet.'); } catch(err){setError(getErrorMessage(err));}
  }

  return <div className="app-shell">
    <div className="page-layout">
      <header className="topbar"><button className="brand" onClick={()=>switchTab('recipes')} aria-label="Matkort: gå til retter"><span className="brand-icon"><Leaf size={21}/></span><span>matkort<span className="brand-dot">.</span></span></button><span className="header-side"><span className="header-label"><span className="status-dot"/>Privat næringskalkulator</span><span className="app-version">v{version}</span></span></header>
      <div className="desktop-layout"><aside className="sidebar"><div className="sidebar-heading">MIN OVERSIKT</div>
        <button className={'nav-item '+(tab==='recipes'?'active':'')} onClick={()=>switchTab('recipes')}><BookOpenText size={20}/> Retter <span>{recipes.length}</span></button>
        <button className={'nav-item '+(tab==='products'?'active':'')} onClick={()=>switchTab('products')}><ShoppingBasket size={20}/> Produkter <span>{products.length}</span></button>
        <button className={'nav-item '+(tab==='settings'?'active':'')} onClick={()=>switchTab('settings')}><Settings2 size={20}/> Innstillinger</button>
        <div className="sidebar-tip"><Sparkles size={20}/><p><strong>Lite tips</strong><br/>Legg inn produktene én gang, og bruk dem i så mange retter du vil.</p></div>
      </aside>
      <main className="main-content" id="main">
        {toast && <div className="notice notice--success toast"><Check size={17}/><span>{toast}</span><button className="icon-button" onClick={()=>setToast('')} aria-label="Lukk beskjed"><X size={16}/></button></div>}
        {error && <div className="notice notice--error toast"><Info size={17}/><span>{error}</span><button className="icon-button" onClick={()=>setError('')} aria-label="Lukk feilmelding"><X size={16}/></button></div>}
        {loading ? <div className="loading">Åpner matkort …</div> : <>
          {productEditor && <ProductEditor key={productEditor==='new'?'new-product':productEditor.id} initial={productEditor==='new'?null:productEditor} onCancel={()=>setProductEditor(null)} onSave={persistProduct}/>}
          {recipeEditor && !productEditor && <RecipeEditor key={recipeEditor==='new'?'new-recipe':recipeEditor.id} initial={recipeEditor==='new'?null:recipeEditor} products={products} onSave={persistRecipe} onCancel={()=>setRecipeEditor(null)} onAddProduct={()=>{if(window.confirm('Ulagrede endringer i retten går tapt. Vil du legge til et nytt produkt nå?')) startProduct('new');}}/>}
          {!productEditor && !recipeEditor && tab==='recipes' && (selectedRecipe ?
            <RecipeDetails recipe={selectedRecipe} products={products} onBack={()=>setSelectedRecipeId(null)} onEdit={()=>startRecipe(selectedRecipe)} onDelete={()=>deleteRecipe(selectedRecipe)} onDuplicate={()=>duplicateRecipe(selectedRecipe)}/>
          : <>
            <SectionHeader eyebrow="OVERSIKT" title="Mine retter" description="Sett sammen ingredienser og få full oversikt over næringsinnholdet." action={<Button onClick={()=>products.length?startRecipe():startProduct()}><Plus size={18}/> Ny rett</Button>}/>
            <div className="overview-cards"><div><span>Lagrede retter</span><strong>{recipes.length}</strong></div><div><span>Produkter</span><strong>{products.length}</strong></div><div className="overview-highlight"><span>Lagret på enheten</span><Leaf size={24}/></div></div>
            {recipes.length ? <><div className="search-field"><Search size={18}/><input aria-label="Søk etter retter" placeholder="Søk i retter …" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="recipe-list">{filteredRecipes.map(r=>{
              const {total,missing}=recipeNutrition(r,products);
              return <button key={r.id} className="recipe-item" onClick={()=>{setSelectedRecipeId(r.id);window.scrollTo({top:0,behavior:'smooth'});}}><span className="recipe-item-icon"><BookOpenText size={22}/></span><span className="recipe-item-main"><strong>{r.name}</strong><small>{r.ingredients.length} ingredienser <span>·</span> {r.portions} porsjoner{missing>0?' · Ufullstendig':''}</small></span><span className="recipe-item-kcal"><strong>{formatNumber(total.kcal,0)}</strong><small>kcal totalt</small></span><ChevronRight size={20} className="recipe-chevron"/></button>;
            })}</div>{!filteredRecipes.length && <p className="search-empty">Ingen retter samsvarer med søket.</p>}</> : <EmptyState icon={<BookOpenText size={32}/>} title="Din første rett starter her" description="Legg inn et produkt fra næringsdeklarasjonen, og sett deretter sammen din første rett."><Button onClick={()=>startProduct()}><Plus size={18}/> Legg til produkt</Button></EmptyState>}
          </>)}
          {!productEditor && !recipeEditor && tab==='products' && <>
            <SectionHeader eyebrow="DITT MATVAREBIBLIOTEK" title="Mine produkter" description="Lagre næringsinnholdet fra emballasjen én gang og gjenbruk det i retter." action={<Button onClick={()=>startProduct()}><Plus size={18}/> Nytt produkt</Button>}/>
            {products.length ? <><div className="search-field"><Search size={18}/><input aria-label="Søk etter produkter" placeholder="Søk i produkter …" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="product-list">{filteredProducts.map(p=><div className="product-item" key={p.id}>
              <div className="product-identity"><span className="product-icon"><ShoppingBasket size={21}/></span><div><strong>{p.name}</strong><small>Per 100 {p.baseUnit}</small></div></div><div className="product-stats"><div><strong>{formatNumber(p.nutrition.kcal,0)}</strong><small>kcal</small></div><div><strong>{formatNumber(p.nutrition.protein)}</strong><small>protein</small></div><div><strong>{formatNumber(p.nutrition.carbs)}</strong><small>karbo</small></div><div><strong>{formatNumber(p.nutrition.fat)}</strong><small>fett</small></div></div>
              <div className="product-actions"><button onClick={()=>startProduct(p)}>Rediger</button><button onClick={()=>deleteProduct(p)} aria-label={`Slett ${p.name}`}><Trash2 size={17}/></button></div></div>)}</div>{!filteredProducts.length&&<p className="search-empty">Ingen produkter samsvarer med søket.</p>}</> : <EmptyState icon={<ScanLine size={32}/>} title="Ingenting i biblioteket enda" description="Ta bilde av næringsdeklarasjonen, eller legg inn verdiene manuelt."><Button onClick={()=>startProduct()}><Camera size={18}/> Legg til første produkt</Button></EmptyState>}
          </>}
          {!productEditor && !recipeEditor && tab==='settings' && <div className="settings-screen"><SectionHeader eyebrow="DATA & PERSONVERN" title="Innstillinger" description="Alt du lagrer, ligger lokalt i denne nettleseren på enheten din."/>
            <div className="settings-card"><div className="settings-icon"><Download size={21}/></div><div><h3>Eksporter sikkerhetskopi</h3><p>Last ned alle produkter og retter som én JSON-fil. Smart før du bytter telefon eller tømmer Safari-data.</p><Button variant="outline" onClick={exportData}><Download size={17}/> Last ned backup</Button></div></div>
            <div className="settings-card"><div className="settings-icon"><Upload size={21}/></div><div><h3>Importer sikkerhetskopi</h3><p>Gjenopprett fra en tidligere eksport. Eksisterende data erstattes etter bekreftelse.</p><Button variant="outline" onClick={()=>importRef.current?.click()}><Upload size={17}/> Velg JSON-fil</Button><input className="sr-only" type="file" accept="application/json,.json" ref={importRef} onChange={importData}/></div></div>
            <div className="settings-card"><div className="settings-icon"><Sparkles size={21}/></div><div><h3>Legg inn eksempeldata</h3><p>Prøv appen med pannekaker, mel, melk og egg. Kun mulig når databasen er tom.</p><Button variant="outline" disabled={!!products.length || !!recipes.length} onClick={loadExamples}><Plus size={17}/> Prøv eksempel</Button></div></div>
            <div className="settings-card"><div className="settings-icon danger-icon"><Trash2 size={21}/></div><div><h3>Slett alle lokale data</h3><p>Dette kan ikke angres uten en sikkerhetskopi.</p><Button variant="danger" onClick={clearAll}><Trash2 size={17}/> Slett alt</Button></div></div>
            <div className="privacy-info"><Info size={19}/><p><strong>Ingen konto. Ingen sky.</strong> Beregningene gjøres på telefonen. OCR kjører lokalt med worker og språkmodell som følger med appen. Bilder og matdata sendes ikke videre. Dataene kan forsvinne hvis nettleserens nettsteddata slettes, så bruk eksport jevnlig.</p></div>
          </div>}
        </>}
      </main></div>
      <footer className="site-footer"><span>matkort. — laget for ditt eget bruk</span><span>Ingen innlogging · Ingen abonnement</span></footer>
    </div>
    <nav className="mobile-nav" aria-label="Hovedmeny"><button className={tab==='recipes'?'active':''} onClick={()=>switchTab('recipes')}><BookOpenText size={22}/><span>Retter</span></button><button className={tab==='products'?'active':''} onClick={()=>switchTab('products')}><ShoppingBasket size={22}/><span>Produkter</span></button><button className={tab==='settings'?'active':''} onClick={()=>switchTab('settings')}><Menu size={22}/><span>Mer</span></button></nav>
  </div>;
}
export default App;
