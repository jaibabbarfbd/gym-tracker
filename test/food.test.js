// Run with: npm test  (Node's built-in test runner, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

test('barcodeValid accepts real EAN-13, UPC-A, EAN-8 and UPC-E codes', () => {
  assert.equal(L.barcodeValid('8901058851298'), true); // Maggi, EAN-13
  assert.equal(L.barcodeValid('036000291452'), true); // UPC-A
  assert.equal(L.barcodeValid('96385074'), true); // EAN-8
  assert.equal(L.barcodeValid('04252614'), true); // UPC-E
  assert.equal(L.barcodeValid('00016000275287'), true); // GTIN-14
});

test('barcodeValid rejects misreads and junk', () => {
  assert.equal(L.barcodeValid('8901058851297'), false); // wrong check digit
  assert.equal(L.barcodeValid('12345'), false);
  assert.equal(L.barcodeValid('1234567890'), false); // 10 digits isn't a food barcode
  assert.equal(L.barcodeValid('89010588512a8'), false);
  assert.equal(L.barcodeValid(''), false);
});

test('upcEtoA expands all four UPC-E patterns', () => {
  assert.equal(L.upcEtoA('04252614'), '042100005264'); // last digit 0-2
  assert.equal(L.upcEtoA('01234531'), '012300000451'); // 3
  assert.equal(L.upcEtoA('01234548'), '012340000058'); // 4
  assert.equal(L.upcEtoA('01234565'), '012345000065'); // 5-9
  assert.equal(L.upcEtoA('91234565'), null); // number system must be 0 or 1
});

test('barcodeVariants covers UPC-A / EAN-13 / UPC-E spellings, as scanned first', () => {
  assert.deepEqual(L.barcodeVariants('036000291452'), ['036000291452', '0036000291452']);
  assert.deepEqual(L.barcodeVariants('0036000291452'), ['0036000291452', '036000291452']);
  assert.deepEqual(L.barcodeVariants('8901058851298'), ['8901058851298']);
  assert.deepEqual(L.barcodeVariants('04252614'), ['04252614', '042100005264', '0042100005264']);
  assert.deepEqual(L.barcodeVariants('96385074'), ['96385074']); // EAN-8, not UPC-E
});

test('gtin14 makes UPC-A and EAN-13 spellings of one product equal', () => {
  assert.equal(L.gtin14('016000275287'), '00016000275287');
  assert.equal(L.gtin14('0016000275287'), L.gtin14('016000275287'));
});

test('usdaFood scales per-100 g nutrients to the label serving', () => {
  const f = L.usdaFood({
    description: 'CHEERIOS CEREAL', brandName: 'CHEERIOS', brandOwner: 'General Mills', gtinUpc: '00016000275287',
    servingSize: 20, servingSizeUnit: 'GRM', householdServingFullText: '3/4 cup (20g)',
    foodNutrients: [{ nutrientId: 1003, value: 12.8 }, { nutrientId: 1008, value: 359 }],
  });
  assert.deepEqual(f, { name: 'Cheerios Cereal', brand: 'Cheerios', serving: '3/4 cup (20g)', cal: 72, protein: 2.56, code: '00016000275287', source: 'USDA' });
});

test('usdaFood falls back to 100 g and leaves missing nutrients empty', () => {
  const f = L.usdaFood({ description: 'Protein Bar', brandOwner: 'Acme', servingSizeUnit: 'MLT', servingSize: 0, foodNutrients: [{ nutrientId: 1003, value: 30 }] });
  assert.equal(f.serving, '100 ml');
  assert.equal(f.cal, null);
  assert.equal(f.protein, 30);
  assert.equal(L.usdaFood({ description: '' }), null);
});

test('usdaFood adds the weight to a household serving without one', () => {
  const f = L.usdaFood({ description: 'Bar', servingSize: 60, servingSizeUnit: 'g', householdServingFullText: '1 bar', foodNutrients: [{ nutrientId: 1008, value: 400 }, { nutrientId: 1003, value: 33 }] });
  assert.equal(f.serving, '1 bar (60 g)');
  assert.equal(f.cal, 240);
  assert.equal(f.protein, 19.8);
});

test('offFood uses the English name when the local one is missing', () => {
  const f = L.offFood({ product_name: '', product_name_en: 'Masala Noodles', brands: 'Maggi', nutriments: { 'energy-kcal_100g': 400, proteins_100g: 9 } });
  assert.equal(f.name, 'Masala Noodles');
  assert.equal(f.serving, '100 g');
  assert.equal(f.source, 'Open Food Facts');
});

test('pieceInfo reads countable servings, with the weight of one piece', () => {
  assert.deepEqual(L.pieceInfo('3 biscuits (34 g)'), { count: 3, one: 'biscuit', many: 'biscuits', size: 11.33, unit: 'g' });
  assert.deepEqual(L.pieceInfo('1 bar (50 g)'), { count: 1, one: 'bar', many: 'bars', size: 50, unit: 'g' });
  assert.deepEqual(L.pieceInfo('5 pieces (23 g)'), { count: 5, one: 'piece', many: 'pieces', size: 4.6, unit: 'g' });
  assert.deepEqual(L.pieceInfo('2 Cookies'), { count: 2, one: 'cookie', many: 'cookies', size: null, unit: null });
  assert.deepEqual(L.pieceInfo('4 pcs'), { count: 4, one: 'piece', many: 'pieces', size: null, unit: null });
  assert.equal(L.pieceInfo('1 can (300 ml)').unit, 'ml');
  assert.equal(L.pieceInfo('10 pieces').count, 10);
});

test('pieceInfo ignores servings that are not a count', () => {
  for (const s of ['100 g', '1 katori', '1 cup (200 g)', '30 g', '½ pack popped (35 g)', '2 large', '1 medium', '', undefined]) {
    assert.equal(L.pieceInfo(s), null, String(s));
  }
});

test('built-in chocolates and biscuits can be counted by the piece', () => {
  const find = (name) => Object.values(L.PACKAGED).flat().find((x) => x[0] === name);
  const [, serving, cal] = find('Oreo');
  const pc = L.pieceInfo(serving);
  assert.equal(pc.count, 3);
  assert.equal(Math.round((cal * 4) / pc.count), 217); // 4 Oreos
  assert.equal(L.pieceInfo(find('Ferrero Rocher')[1]).one, 'piece');
});

test('built-in food lists are well formed, with no duplicate names', () => {
  const seen = new Set();
  for (const lists of [L.FOODS, L.PACKAGED]) {
    for (const [cat, items] of Object.entries(lists)) {
      for (const item of items) {
        const [name, serving, cal, protein] = item;
        assert.equal(item.length, 4, `${cat}: ${name}`);
        assert.ok(name && serving, `${cat}: ${name}`);
        assert.ok(Number.isFinite(cal) && cal >= 0 && cal < 2000, `${cat}: ${name} kcal`);
        assert.ok(Number.isFinite(protein) && protein >= 0 && protein * 4 <= cal + 5, `${cat}: ${name} protein`);
        assert.ok(!seen.has(name.toLowerCase()), `duplicate food: ${name}`);
        seen.add(name.toLowerCase());
      }
    }
  }
});
