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
- **Düzenleme:** kimlik saklayıp etiket gösteren açılır listeler, sunucuda aranan seçenekler, React bileşeni de olabilen özel editörler.
- **Satırlar:** açılır ayrıntı alanları, gizli satırlar, satır tıklama olayları, alt toplamlar, notlar ve bağlantılar.
- **Dokunmatik:** tutamaçlar parmağı izler, uzun basış sağ tık menüsünü açar.
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

Okunanlar: değerler, formüller, sayı biçimleri, yazı tipleri, dolgular, hizalama, sütun genişlikleri, satır yükseklikleri, gizli satır ve sütunlar, sabit bölmeler, birleştirmeler ve tanımlı adlar. Okunmayanlar: grafikler, resimler, yorumlar, koşullu biçimler ve veri doğrulama. Dosyada motorun bilmediği fonksiyonlar varsa `formulas: 'values'` ile formüller yerine dosyadaki sonuçları alabilirsiniz.

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

`query` içinde `page`, `pageSize`, `sort: [{ field, desc }]`, `filters` ve `search` bulunur. Alanlar her zaman kolon kimliğidir, bu yüzden kolon gizlemek ya da taşımak sorguyu bozmaz. Süzgeç türleri `text`, `list`, `date` (`from`, `to`), `number` (`min`, `max`) ve `boolean`'dır. React olmadan `afterQueryChange` olayını dinleyip satırları `grid.setPageRows(satirlar, toplam)` ile verin.

Bilmeniz gerekenler:

- Yalnızca `sortable` ya da `serverFilter` tanımlı kolonlarda menü çıkar.
- Sıralama, süzgeç ve sayfa boyutu değişince 1. sayfaya dönülür.
- Yeni satırlar gelince sıralama işaretleri, süzgeçler, kolon düzeni, kaydırma konumu ve `rowKey` ile seçim korunur.
- Eski yanıtları reddetmek için `query.requestId` değerini geri verin: React'te `dataRequestId`, diğerlerinde `setPageRows(satirlar, toplam, { requestId })`.
- Aynı satırları taşıyan yeni bir dizi yeni sayfa sayılmaz. `loading` açıkken boş `data` eski satırları silmez.
- `onBeforeQueryChange` (`beforeQueryChange` olayı) `false` döndürerek değişikliği durdurabilir; örneğin kaydedilmemiş düzenlemeler için. Açık editör önce kaydedilir.
- `maxSortKeys: 2` sütun menüsünde "Sonra sırala" seçeneğini açar; başlıklarda öncelik numaraları görünür.
- Değişiklik olayları `rowKey` ve `columnId` taşır; düzenlemeleri sayfa değişmeden önce de dahil kaydetmek uygulamaya aittir.
- Geri alma geçmişi her yeni sayfada sıfırlanır.
- `formulas` verilmedikçe formüller kapalıdır; açılırsa yalnızca yüklü sayfayı görür.
- Tümünü seçme, bul ve değiştir, `downloadCSV`/`downloadXLSX` yalnızca yüklü sayfayı kapsar; `downloadAllCSV`/`downloadAllXLSX` ise `fetchAllRows` ile tüm sonucu aktarır.
- Satırlar yerelde eklenip silinemez. Sığmayan yapıştırma kesilir ve `afterPasteClipped` ile bildirilir.

### Satır olayları ve kolon düzeni

```tsx
<CenituTable
  rowKey="id"
  columnLayout={kayitli}
  onColumnLayoutChange={(duzen) => localStorage.setItem('siparisler', JSON.stringify(duzen))}
  onRowDoubleClick={({ rowKey }) => {
    siparisiAc(rowKey);
    return false; // hücre editörünü kapalı tutar
  }}
/>
```

Kolon düzeni için kolon kimliği gerekir (`columns[i].id` ya da `data`). Geri yüklerken kaldırılmış kolonlar atlanır, yeni kolonlar kayıtlı olanların sonrasında kalır. Tarayıcıdaki gibi çift tıklama iki satır tıklaması da üretir. `setColumnLayout` kolon taşırsa geri alma geçmişini temizler.

### Editörler ve açılır listeler

```tsx
import { reactEditor, reactRenderer } from 'cenitu-table/react';

const columns = [
  // Kimliği saklar, etiketi gösterir; yazılan ve yapıştırılan etiketler kimliğe çevrilir.
  { data: 'durumId', type: 'dropdown', source: [{ value: 1, label: 'Açık' }, { value: 2, label: 'Kapalı' }] },
  // Sunucuda arar. Eski istekler `signal` ile iptal edilir.
  {
    data: 'cariId',
    type: 'dropdown',
    loadOptions: (sorgu, signal) => api.cariler(sorgu, { signal }),
    resolveLabel: (id, satir) => satir.cari?.ad,
  },
  { data: 'renk', editor: reactEditor(RenkSecici) }, // prop'lar: value, commit, cancel, row, col…
  { data: 'durum', renderer: reactRenderer(DurumRozeti) }, // prop'lar: value, context
];
```

React olmadan editör bir fonksiyondur: `editor: ({ el, value, commit, cancel }) => ({ getValue, destroy })`. `el` içine çizer, `commit(deger)` ya da `cancel()` ile biter. Başka yere tıklanınca varsa `getValue()` saklanır; `destroy` nasıl kapanırsa kapansın bir kez çalışır. `loadOptions` ile yalnızca metin yazmak değeri değiştirmez: seçenek seçilmeli ya da hücre boşaltılmalıdır (`strict: false` serbest metne izin verir).

`renderer` bir temizlik fonksiyonu döndürebilir; hücre elemanı kaydırma sırasında yeniden kullanılırken çağrılır.

### Satırlar, toplamlar, notlar ve bağlantılar

```ts
import { linkRenderer } from 'cenitu-table';

new CenituGrid(el, {
  data,
  rowDetail: (alan, satir) => void (alan.textContent = satir.aciklama), // satır başlığında açma işareti
  rowDetailHeight: 'auto', // ya da px cinsinden yükseklik
  columns: [
    { data: 'tutar', summary: 'sum' }, // sum, avg, count, min, max ya da fonksiyon
    { data: 'site', renderer: linkRenderer((v) => String(v)) }, // yalnızca http, https, mailto, tel
  ],
});

grid.hideRows([3]);
grid.setCellNote(0, 1, 'Kontrol et');
```

Sunucu modunda toplamlar `summaryValues: { tutar: 1234 }` ile verilir, çünkü sayfa bunları bilemez. Tüm sonucu dışa aktarmak için `fetchAllRows: (sorgu) => api.tumu(sorgu)` verip `downloadAllXLSX()` ya da `downloadAllCSV()` çağırın.

### Tema

`theme: 'light' | 'dark' | 'auto'` çalışırken `updateSettings` ya da React prop'uyla değiştirilebilir. Renkler `.ct-root`, `.ct-menu`, `.ct-bar` ve `.ct-pager` üzerindeki CSS değişkenleridir: `--ct-bg`, `--ct-fg`, `--ct-muted`, `--ct-grid`, `--ct-header-bg`, `--ct-header-fg`, `--ct-header-hl`, `--ct-accent`, `--ct-range`, `--ct-error`, `--ct-invalid-bg`, `--ct-readonly-fg`, `--ct-shadow`, `--ct-match`, `--ct-note`.

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
