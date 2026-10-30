# CenituTable

Spreadsheet benzeri, sanal kaydırmalı bir data grid ve ona bağlı, çok sayfalı bir formül motoru. Çalışma zamanı bağımlılığı yok; TypeScript ile yazıldı. React sarmalayıcısı isteğe bağlı.

Tasarım ve kapsam için: [docs/SPEC.md](docs/SPEC.md). Bu belge, mevcut spreadsheet bileşenlerinin public API'leri ve mimarileri incelenerek yazılmış bir clean-room spesifikasyonudur; başka bir projenin kodu kullanılmamıştır.

## Özellikler

- **Grid:**
  - Sanal kaydırma (yalnızca görünen hücreler DOM'da).
  - Seçim, klavye gezinmesi (Ctrl+ok ile veri bloğu sonuna atlama).
  - Excel uyumlu kopyala/kes/yapıştır.
  - Geri al/yinele.
  - Sütun genişliği ayarı; satır/sütun ekleme-silme.
- **Sıralama ve filtre:**
  - Excel benzeri sütun menüsü: koşula göre ve değer listesine göre filtre.
  - Yalnızca görünümü değiştirir; veri ve formüller yerinde kalır.
- **Doldurma tutamacı:** sayı ve metin serileri, göreli formül kaydırma, çift tıklamayla otomatik doldurma, Ctrl+D.
- **Hücre tipleri:**
  - Sayı (Intl biçimleri: para, yüzde), tarih, onay kutusu, açılır liste.
  - Doğrulayıcılar, salt-okunur hücreler, özel renderer.
- **Sabit satır/sütunlar ve birleştirilmiş hücreler.**
- **Formül motoru:**
  - 55 fonksiyon: SUM, IF, VLOOKUP, INDEX/MATCH, SUMIF, tarih fonksiyonları…
  - Sayfalar arası referanslar (`'Diğer Sayfa'!A1`) ve isimli ifadeler.
  - Artımlı yeniden hesaplama, döngü tespiti.
- **React:** `cenitu-table/react` ile `<CenituTable />` bileşeni.

## Komutlar

```bash
npm install
npm run dev        # demo: http://localhost:5180 (2 sayfa, 5.000 satır, ~25.000 formül)
npm test           # vitest: motor, grid, React (jsdom)
npm run build      # tip denetimi + ESM/CJS paketleri + .d.ts (dist/)
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
grid.getDataAtCell(1, 3);        // 25   (hesaplanmış değer)
grid.getSourceDataAtCell(1, 3);  // "=B2*C2"
```

Birden fazla sayfa için tek bir motoru birden fazla grid'e verin (her grid bir sayfa):

```ts
import { CenituGrid, FormulaEngine } from 'cenitu-table';

const engine = FormulaEngine.buildEmpty();
engine.addNamedExpression('KdvOrani', 0.2);
new CenituGrid(el1, { formulas: engine, sheetName: 'Siparişler', data: orders });
new CenituGrid(el2, { formulas: engine, sheetName: 'Özet', data: [['=SUM(Siparişler!F2:F100)*(1+KdvOrani)']] });
```

React:

```tsx
import { CenituTable } from 'cenitu-table/react';

<CenituTable ref={gridRef} data={data} fixedRowsTop={1} onChange={(changes) => save(changes)} />;
```

Formül motoru grid olmadan da kullanılabilir:

```ts
import { FormulaEngine, registerFunction } from 'cenitu-table';

const engine = FormulaEngine.buildFromArray([[1, 2, '=A1+B1']]);
engine.setCellContents({ row: 0, col: 0 }, 10);   // değişen hücreleri döndürür
engine.getCellValue({ row: 0, col: 2 });          // 12
registerFunction('DOUBLE', { minArgs: 1, maxArgs: 1, impl: ([x]) => (x as number) * 2 });
```

## Yapı

| Klasör | İçerik |
|---|---|
| `src/formula` | lexer → Pratt parser → AST (göreli referanslar ofset olarak), çok sayfalı bağımlılık grafiği, artımlı yapısal değişiklikler, topolojik yeniden hesaplama, fonksiyonlar, tarih yardımcıları |
| `src/grid` | satır eşleyici (sıralama/filtre), dört bölmeli çizim, hücre tipleri, doldurma, birleştirme, sütun menüsü, editör, pano, geri alma |
| `src/react` | React bileşeni |
| `demo/` | geliştirme demo sayfası |
| `_research/` | yalnızca inceleme için indirilen paketler (git'e girmez, projeye import edilmez) |

## Performans (demo, Chromium)

| İşlem | Süre |
|---|---|
| Yükleme (25.000 formül) | ~140–300 ms |
| Hücre düzenleme (16 SUMIF yeniden hesaplanır) | ~20 ms |
| Sıralama / filtre (5.000 satır) | ~10 / ~13 ms |
| Satır ekleme veya geri alma | ~100–130 ms |

## Bilinen sınırlamalar

Bkz. [SPEC §4](docs/SPEC.md#4-kapsam-dışı-sonraki-fazlar): dizi formülleri, 3B aralıklar, sayfa kapsamlı isimler, TODAY/NOW için otomatik yenileme, satır yüksekliği ayarı, sütun taşıma/gizleme.

## Lisans

[MIT](LICENSE)
