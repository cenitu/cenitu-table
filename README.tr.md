# CenituTable

Spreadsheet benzeri bir data grid ve ona bağlı, çok sayfalı bir formül motoru. TypeScript ile yazıldı, **çalışma zamanı bağımlılığı yok**. İsteğe bağlı bir React bileşeni de içeriyor.

**[Canlı demo](https://cenitu.github.io/cenitu-table/)** · [English](README.md) · [Tasarım notları](docs/SPEC.md)

## Özellikler

- **Grid:** sanal kaydırma (yalnızca görünen hücreler DOM'da), klavye gezinmesi (Ctrl+ok ile veri bloğu sonuna atlama), Excel uyumlu kopyala/kes/yapıştır, geri al/yinele, sütun ve satır boyutlandırma, satır/sütun ekleme-silme, sağ tık menüsü.
- **Sıralama ve filtre:** koşula ve değer listesine göre filtreleyen sütun menüsü. Yalnızca görünüm değişir; veri ve formüller yerinde kalır.
- **Doldurma tutamacı:** sayı ve metin serileri, göreli kayan formüller, çift tıklamayla otomatik doldurma, Ctrl+D.
- **Hücre tipleri:** sayı (para, yüzde gibi Intl biçimleri), tarih, onay kutusu, açılır liste; doğrulayıcılar, salt-okunur hücreler, özel çiziciler.
- **Biçimlendirme:** kalın, italik, altı çizili, üstü çizili, renkler, hizalama, metin kaydırma (Ctrl+B / I / U); hücre ya da tüm satır için koşullu biçimlendirme.
- **Yerleşim:** sabit satır ve sütunlar, birleştirilmiş hücreler, gizli sütunlar, sürükleyerek sütun taşıma.
- **Formül motoru:** 100'den fazla fonksiyon (SUM, IF, XLOOKUP, SUMIFS, TEXT, tarih fonksiyonları…), taşan dinamik diziler (FILTER, SORT, UNIQUE, SEQUENCE), sayfalar arası referanslar (`'Diğer Sayfa'!A1`), isimli ifadeler, artımlı yeniden hesaplama, döngü tespiti.
- **Veri bağlama:** satırlar dizi ya da nesne olarak verilebilir. Nesnelerde sütunlar alan yoluna bağlanır ve düzenlemeler nesnelerinize geri yazılır.
- **Dışa aktarma:** CSV (formül enjeksiyonuna karşı korumalı) ve XLSX (formüller, biçimler, stiller, sabit bölmeler, birleştirmeler); hiçbir kütüphane kullanmadan.
- **Erişilebilirlik:** ARIA grid rolleri, ekran okuyucuya duyurulan aktif hücre.
- **React:** `cenitu-table/react` içinden `<CenituTable />`.

## Kurulum

```bash
npm install cenitu-table
```

## Kullanım

```ts
import { CenituGrid, trTR } from 'cenitu-table';

const grid = new CenituGrid(document.getElementById('grid')!, {
  data: [
    ['Ürün', 'Adet', 'Fiyat', 'Tutar'],
    ['Vida', 10, 2.5, '=B2*C2'],
    ['Somun', 20, 1.25, '=B3*C3'],
  ],
  fixedRowsTop: 1,
  columnSorting: true,
  filters: true,
  contextMenu: true,
  locale: 'tr-TR',
  language: trTR,
  columns: [
    { type: 'dropdown', source: ['Vida', 'Somun', 'Pul'] },
    { type: 'numeric', validator: (v) => Number(v) > 0 || 'Pozitif olmalı' },
    { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } },
    { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' }, readOnly: true },
  ],
  height: 400,
});

grid.addHook('afterChange', (changes, source) => console.log(changes, source));
grid.getDataAtCell(1, 3);       // 25 (hesaplanmış değer)
grid.getSourceDataAtCell(1, 3); // "=B2*C2"
```

### Dizi yerine nesneler

```ts
const siparisler = [{ urun: 'Vida', adet: 10, musteri: { ad: 'Acme' } }];

new CenituGrid(el, {
  data: siparisler,
  columns: [{ data: 'urun' }, { data: 'adet', type: 'numeric' }, { data: 'musteri.ad', title: 'Müşteri' }],
  dataSchema: () => ({ urun: '', adet: 0, musteri: { ad: '' } }),
});
// Düzenlemeler geri yazılır: hücre değişince siparisler[0].adet de değişir.
```

Formül hücreleri nesneye hesaplanmış değeri yazar ve güncel tutar; böylece alanlarınız düz değer olarak kalır. Formül metnini saklamak için `bindFormulas: 'text'` kullanın.

### Birden fazla sayfa

Tek bir motoru birden fazla grid'e verin (her grid bir sayfa):

```ts
import { CenituGrid, FormulaEngine } from 'cenitu-table';

const engine = FormulaEngine.buildEmpty();
engine.addNamedExpression('KdvOrani', 0.2);
new CenituGrid(el1, { formulas: engine, sheetName: 'Siparişler', data: siparisler });
new CenituGrid(el2, { formulas: engine, sheetName: 'Özet', data: [['=SUM(Siparişler!F2:F100)*(1+KdvOrani)']] });
```

### Dışa aktarma

```ts
grid.downloadCSV('siparisler.csv');                   // tr-TR'de ";" ayraç ve "," ondalık
await grid.downloadXLSX('kitap.xlsx', [ozetGrid]);    // birden fazla sayfa tek dosyada
```

### React

```tsx
import { CenituTable } from 'cenitu-table/react';

<CenituTable ref={gridRef} data={data} fixedRowsTop={1} onChange={(changes) => kaydet(changes)} />;
```

### Yalnızca formül motoru

```ts
import { FormulaEngine, registerFunction } from 'cenitu-table';

const engine = FormulaEngine.buildFromArray([[1, 2, '=A1+B1']]);
engine.setCellContents({ row: 0, col: 0 }, 10); // değişen hücreleri döndürür
engine.getCellValue({ row: 0, col: 2 });         // 12
registerFunction('DOUBLE', { minArgs: 1, maxArgs: 1, impl: ([x]) => (x as number) * 2 });
```

## Geliştirme

```bash
npm install
npm run dev        # demo: http://localhost:5180
npm test           # birim testleri (vitest + jsdom)
npm run test:e2e   # tarayıcı testleri (Playwright: Chromium, Firefox, WebKit)
npm run build      # tip denetimi, ESM/CJS paketleri ve dist/ altında .d.ts
```

Bkz. [CONTRIBUTING.md](CONTRIBUTING.md). Önemli değişiklikler [CHANGELOG.md](CHANGELOG.md)'de.

## Lisans

[MIT](LICENSE)
