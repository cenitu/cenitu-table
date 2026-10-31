# CenituTable

Spreadsheet benzeri bir data grid ve ona bağlı, çok sayfalı bir formül motoru. TypeScript ile yazıldı, **çalışma zamanı bağımlılığı yok**. İsteğe bağlı bir React bileşeni de içeriyor.

**[Canlı demo](https://cenitu.github.io/cenitu-table/)** · [English](README.md) · [Tasarım notları](docs/SPEC.md)

## Özellikler

- **Grid:** sanal kaydırma (yalnızca görünen hücreler DOM'da), klavye gezinmesi (Ctrl+ok ile veri bloğu sonuna atlama), Excel uyumlu, biçimli kopyala/kes/yapıştır, geri al/yinele, sütun ve satır boyutlandırma, satır/sütun ekleme-silme, sağ tık menüsü.
- **Sıralama ve filtre:** birden fazla sütuna göre sıralama, sütun menüsünden koşula ya da değere göre filtre. Yalnızca görünüm değişir; veri ve formüller yerinde kalır.
- **Bul ve değiştir:** Ctrl+F / Ctrl+H; ekran dışındaki satırlarda da çalışır, görünen değerlerde ya da formüllerde arar.
- **Formül çubuğu:** aktif hücrenin adresi ve içeriği grid'in üstünde gösterilir, buradan düzenlenebilir.
- **Doldurma tutamacı:** sayı ve metin serileri, göreli kayan formüller, çift tıklamayla otomatik doldurma, Ctrl+D.
- **Hücre tipleri:** sayı (para, yüzde gibi Intl biçimleri), tarih, onay kutusu, açılır liste; doğrulayıcılar, salt-okunur hücreler, özel çiziciler.
- **Biçimlendirme:** kalın, italik, altı çizili, üstü çizili, renkler, hizalama, metin kaydırma (Ctrl+B / I / U); hücre ya da tüm satır için koşullu biçimlendirme.
- **Yerleşim:** sabit satır ve sütunlar, birleştirilmiş hücreler, gizli sütunlar, sürükleyerek sütun taşıma.
- **Formül motoru:** 100'den fazla fonksiyon (SUM, IF, XLOOKUP, SUMIFS, TEXT, tarih fonksiyonları…), taşan dinamik diziler (FILTER, SORT, UNIQUE, SEQUENCE), sayfalar arası referanslar (`'Diğer Sayfa'!A1`), isimli ifadeler, artımlı yeniden hesaplama, döngü tespiti.
- **Sunucu modu:** sayfalama, sıralama ve süzme arka uçta; sayfa çubuğu ile metin, liste, tarih ve evet/hayır süzgeçleri.
- **Veri bağlama:** satırlar dizi ya da nesne olarak verilebilir. Nesnelerde sütunlar alan yoluna bağlanır ve düzenlemeler nesnelerinize geri yazılır.
- **İçe ve dışa aktarma:** XLSX okuma ve yazma (formüller, biçimler, stiller, sabit bölmeler, birleştirmeler), formül enjeksiyonuna karşı korumalı CSV; hiçbir kütüphane kullanmadan.
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

### İçe aktarma

```ts
await grid.importXLSX(dosya, { sheet: 'Siparişler' }); // File, Blob ya da bayt dizisi; varsayılan ilk sayfa
```

Bütün çalışma kitabını yüklemek için tüm grid'lere tek motor verin; böylece formüller diğer sayfalara ulaşır:

```ts
import { CenituGrid, readXLSX, workbookEngine } from 'cenitu-table';

const kitap = await readXLSX(dosya);
const engine = workbookEngine(kitap);
kitap.sheets.forEach((sayfa, i) => {
  new CenituGrid(alanlar[i], { formulas: engine, sheetName: sayfa.name }).loadSheet(sayfa);
});
```

Okunanlar: değerler, formüller, sayı biçimleri, yazı tipleri, dolgular, hizalama, sütun genişlikleri, satır yükseklikleri, gizli sütunlar, sabit bölmeler, birleştirmeler ve tanımlı adlar. Okunmayanlar: grafikler, resimler, yorumlar, koşullu biçimler, veri doğrulama ve gizli satırlar (görünür hale gelir). Dosyada motorun bilmediği fonksiyonlar varsa `formulas: 'values'` ile formüller yerine dosyadaki sonuçları alabilirsiniz.

### Sunucu modu

Tarayıcıya sığmayacak listelerde grid hangi satırlara ihtiyacı olduğunu bildirir, veriyi uygulamanız getirir. Grid kendi başına sıralama ya da süzme yapmaz.

```tsx
<CenituTable
  dataMode="server"
  rowKey="id"
  data={sayfa.items}
  totalCount={sayfa.totalCount}
  loading={yukleniyor}
  loadError={hataVar}
  query={sorgu}
  onQueryChange={setSorgu}
  columns={[
    { id: 'orderDate', data: 'orderDate', sortable: true, serverFilter: { kind: 'date' } },
    { id: 'status', data: 'status', serverFilter: { kind: 'list', options: durumlar } },
    { id: 'partner', data: 'partner.name' },
  ]}
/>
```

`query` içinde `page`, `pageSize`, `sort: [{ field, desc }]`, `filters` ve `search` bulunur. Alanlar her zaman kolon kimliğidir, bu yüzden kolon gizlemek ya da taşımak sorguyu bozmaz. Süzgeç türleri `text`, `list`, `date` (`from`, `to`) ve `boolean`'dır. React olmadan `afterQueryChange` olayını dinleyip satırları `grid.setPageRows(satirlar, toplam)` ile verin.

Bilmeniz gerekenler:

- Yalnızca `sortable` ya da `serverFilter` tanımlı kolonlarda menü çıkar.
- Sıralama, süzgeç ve sayfa boyutu değişince 1. sayfaya dönülür.
- Yeni satırlar gelince sıralama işaretleri, süzgeçler, kolon düzeni, kaydırma konumu ve `rowKey` ile seçim korunur.
- İstekleri uygulama yaptığı için eski yanıtları yok saymak da uygulamanın işidir.
- Değişiklik olayları `rowKey` ve `columnId` taşır; düzenlemeleri sayfa değişmeden önce de dahil kaydetmek uygulamaya aittir.
- Geri alma geçmişi her yeni sayfada sıfırlanır.
- `formulas` verilmedikçe formüller kapalıdır; açılırsa yalnızca yüklü sayfayı görür.
- Tümünü seçme, bul ve değiştir, CSV/XLSX dışa aktarma yalnızca yüklü sayfayı kapsar.
- Satırlar yerelde eklenip silinemez. Sığmayan yapıştırma kesilir ve `afterPasteClipped` ile bildirilir.

### Bul, formül çubuğu, çok sütunlu sıralama

```ts
new CenituGrid(el, { data, search: true, formulaBar: true, columnSorting: true });

grid.openSearch(true);                                // ya da `search: true` ile Ctrl+F / Ctrl+H
grid.findNext('vida', { matchCase: false });
grid.replaceAll('A1', 'B1', { lookIn: 'formulas' });  // tek geri alma adımı; değişen hücre sayısını döndürür
grid.sortBy([{ col: 2, order: 'desc' }, { col: 0, order: 'asc' }]);
```

`lookIn: 'formulas'` olmadan değiştirme işlemi formül hücrelerine dokunmaz. `formulaBar`, grid'in `height` değerine ek olarak üstte bir satır kaplar. Bir sütun sıralıyken diğer sütunların menüsünde "Sonra sırala" seçenekleri çıkar.

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

### Yerelleştirme

```ts
import { trTR } from 'cenitu-table';

new CenituGrid(el, { locale: 'tr-TR', language: trTR, data });
```

`locale` sayı ve tarih biçimini belirler; `language` arayüz metinlerini taşır (varsayılan İngilizce, Türkçe dahil).

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
