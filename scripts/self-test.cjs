/* Null nettverk; kjør med `npm test` etter npm install. Tester rene funksjoner. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module,exports:module.exports,require:(id)=>{if (id in dependencies)return dependencies[id]; throw Error(`Uventet import ${id}`);},console}, {filename:file});
  return module.exports;
}
const ZERO_NUTRITION = { kcal:0, protein:0, carbs:0, fat:0, fiber:0, salt:0 };
const n = load('src/lib/nutrition.ts', { '../types': { ZERO_NUTRITION } });
const ocr = load('src/lib/ocr.ts');
const product = (name, baseUnit, nutrition, opts={}) => ({id:name,name,baseUnit,nutrition:{...ZERO_NUTRITION,...nutrition},createdAt:1,updatedAt:1,...opts});

test('175 g av 20 g protein / 100 g gir 35 g', ()=>{
  const p=product('p','g',{protein:20});
  const r=n.ingredientNutrition({id:'i',productId:p.id,amount:175,unit:'g'},[p]);
  assert.equal(r.protein,35);
});
test('3 dl melk med 47 kcal / 100 ml gir 141 kcal',()=>{
  const p=product('melk','ml',{kcal:47});
  assert.equal(n.toBaseAmount(p,3,'dl'),300);
  assert.equal(n.ingredientNutrition({id:'i',productId:p.id,amount:3,unit:'dl'},[p]).kcal,141);
});
test('Vekt/volum omregnes ikke uten tetthet',()=>{
  const p=product('mel','g',{kcal:340});
  assert.equal(n.toBaseAmount(p,3,'dl'),null);
  assert.equal(n.availableUnits(p).includes('dl'),false);
});
test('Oppskrift: mel + melk + to egg + porsjoner',()=>{
  const list=[product('mel','g',{kcal:340,protein:11}),product('melk','ml',{kcal:47,protein:3.5}),product('egg','g',{kcal:143,protein:13},{pieceSize:55})];
  const recipe={id:'r',name:'Pannekaker',portions:3,ingredients:[{id:'a',productId:'mel',amount:125,unit:'g'},{id:'b',productId:'melk',amount:3,unit:'dl'},{id:'c',productId:'egg',amount:2,unit:'stk'}]};
  const {total,missing}=n.recipeNutrition(recipe,list);
  assert.equal(missing,0);
  assert.ok(Math.abs(total.kcal-723.3)<0.00001);
  assert.ok(Math.abs(total.kcal/3-241.1)<0.00001);
});
test('Norsk desimalkomma',()=>{
  assert.equal(n.parseNumber('1,25'),1.25);
  assert.equal(n.parseNumber('1 250,5'),1250.5);
});
test('OCR: kcal, protein, karbohydrater, fett',()=>{
  const result=ocr.extractNutrition('Næringsinnhold per 100 g\nEnergi 1500 kJ / 358 kcal\nFett 1,5 g\nhvorav mettede fettsyrer 0,2 g\nKarbohydrater 70 g\nhvorav sukkerarter 1,0 g\nProtein 11 g\nSalt 0,02 g');
  assert.equal(result.baseUnit,'g');
  assert.equal(result.values.kcal,358);
  assert.equal(result.values.protein,11);
  assert.equal(result.values.carbs,70);
  assert.equal(result.values.fat,1.5);
  assert.equal(result.values.salt,0.02);
});
test('OCR laster worker og språkmodell fra appen selv',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/lib/ocr.ts'),'utf8');
  const config=fs.readFileSync(path.resolve(__dirname,'../vite.config.ts'),'utf8');
  assert.equal(source.includes('jsdelivr')||source.includes('projectnaptha'),false);
  assert.equal(source.includes("workerBlobURL: false"),true);
  assert.equal(config.includes('tessdata.projectnaptha.com')||config.includes('0.0.0.0'),false);
});
test('OCR: to kolonner og g lest som 9',()=>{
  const text=`100 grammaan Cheerios Multigrain
NÄRINGSDEKLARATION/ | Per 100 9 Per 30 9
NÆRINGSINDHOLD/ Cheerios Cheerios
RAVINTOARVOILMOITUS | Multigrain | Multigrair
Energi/Energia å 1626kJ * 488kJ
385 kcal 116 kcal
499 159
09g 03g
| 7069 729
17,79 539
94g' 289
1009 30g
0819 024g
innehåller 20 portioner. Portionerna ska`;
  const result=ocr.extractNutrition(text);
  assert.equal(result.baseUnit,'g');
  assert.equal(result.values.kcal,385);
  assert.equal(result.values.fat,4.9);
  assert.equal(result.values.carbs,70.6);
  assert.equal(result.values.fiber,9.4);
  assert.equal(result.values.protein,10);
  assert.equal(result.values.salt,0.81);
});
test('OCR: bare porsjons-kcal brukes ikke som per 100 g',()=>{
  const text=`NÅRINGSDEKLARATION/ | Per 1009 | Per30g
KLE 116 kcal
| Å 949 289
på 10; 309`;
  const result=ocr.extractNutrition(text);
  assert.equal(result.baseUnit,'g');
  assert.equal(result.values.kcal,undefined);
});
test('OCR: per 100 ml og kJ-fallback',()=>{
  const result=ocr.extractNutrition('Næringsinnhold per 100 ml\nEnergi 197 kJ\nProtein 3,5 g');
  assert.equal(result.baseUnit,'ml');
  assert.ok(Math.abs(result.values.kcal-197/4.184)<1e-8);
});
