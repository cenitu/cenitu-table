# CenituTable — Clean-room Spesifikasyon

Bu belge, yaygın bir ticari data grid bileşeni ile açık kaynak bir formül motorunun **mimari
sınırları ve public API yüzeyi** incelenerek yazılmıştır. İmplementasyon kodu kopyalanmamıştır;
CenituTable kodu bu spesifikasyondan bağımsız olarak yazılır.

> Lisans notu: incelenen paketler `_research/` klasöründe yalnızca inceleme içindir; dağıtılmaz,
> depoya girmez ve projeye import edilmez.

## 1. İnceleme yöntemi

| Soru | Kaynak |
|---|---|
| Formül motoru modül sınırları | ES modül import grafiği (19 çekirdek modül, REA statik analiz) |
| Grid modül sınırları | Çekirdek, görünüm ve render katmanı modülleri (14 modül, REA statik analiz) |
| Public API | Paketlerle gelen `.d.ts` tip tanımları |
| Grid ↔ formül motoru entegrasyonu | Formül eklentisinin motor çağrıları ve olay abonelikleri |

Gözlem (statik): analizler kodu çalıştırmadan yapıldı; çalışma zamanı davranışı gözlemlenmedi.

## 2. Gözlemlenen mimari (genel)

### 2.1 Formül motoru

```
Motor (facade: public API, olay yayıcı)
 └─ Kurucu → tüm alt sistemleri bağlar
     ├─ Ayarlar / dil (fonksiyon adı çevirileri)
     ├─ Ayrıştırıcı → lexer → parser → AST  (+ AST'den metne, AST önbelleği)
     ├─ Bağımlılık grafiği
     │    ├─ adres → düğüm eşlemesi (sayfa, satır, sütun)
     │    ├─ aralıklar için paylaşımlı düğümler
     │    └─ topolojik sıralama ve döngü tespiti
     ├─ Değerlendirici   → kirli düğümleri topolojik sırayla hesaplar
     ├─ Yorumlayıcı      → AST yürütür; fonksiyonlar bir kayıt defterinden gelir
     ├─ Yapısal işlemler → satır/sütun/sayfa ekleme-silme, taşıma, adres düzeltme
     ├─ Geri alma, pano, isimli ifadeler, dışa aktarma
     └─ Arama hızlandırma (VLOOKUP/MATCH için sütun indeksi)
```

Önemli tasarım kararları (çıkarım):
- Hücreler bir **düğüm** (değer, formül, boş, aralık, ayrıştırma hatası) olarak modellenir.
- Aralık referansları (`A1:A100`) her hücreye ayrı ayrı değil, **paylaşımlı bir aralık düğümü**
  üzerinden bağlanır. Böylece `SUM(A1:A100)` gibi formüller 100 kenar yerine 1 kenarla bağlanır.
- Formüller **göreli adresli AST** olarak saklanır. Aynı yapıdaki formüller (`=A1+1`, `=A2+1` …)
  aynı AST'yi paylaşabilir.
- Fonksiyonlar gruplar halinde global bir kayıt defterine eklenir.
- Değişiklikler `batch()` ile gruplanır; değişen hücre değerleri olay olarak yayımlanır.

### 2.2 Grid

```
Çekirdek (grid örneği: public API, ayarlar, olaylar)
 ├─ Veri erişimi          → kaynak veri (dizi dizisi veya nesne dizisi)
 ├─ İndeks eşleyici       → görsel ↔ fiziksel satır/sütun (sıralama, gizleme, taşıma)
 ├─ Meta (hücre/sütun)    → hücre başına tip, renderer, editör, doğrulayıcı, salt-okunur
 ├─ Seçim                 → çoklu seçim aralıkları, klavye/fare
 ├─ Editör yöneticisi     → aktif editörü açar/kapatır
 ├─ Olaylar               → before*/after* olayları (eklentiler bunlarla bağlanır)
 ├─ Eklentiler            → pano, formüller, sıralama, sütun boyutlandırma …
 └─ Görünüm
      └─ Render motoru
           ├─ Görünür alan hesabı → görünür satır/sütun aralığı (overscan ile)
           ├─ Konum önbelleği     → satır/sütun offset'leri (prefix-sum)
           ├─ Sabit bölgeler      → sabit üst/sol bölgeler, kaydırma senkronu
           ├─ Hücre çizici        → yalnızca görünür hücreleri çizer, DOM düğümlerini yeniden kullanır
           └─ Seçim çerçeveleri   → ayrı katmanda çizilir
```

### 2.3 Entegrasyon

Grid, formül motorunu **ayrı bir bileşen** olarak kullanır:
- Grid'deki veri değişikliği (hücre yazma, satır/sütun ekleme-silme) → motorda karşılığı
  (`setCellContents`, `addRows`, `removeColumns` …).
- Hücre gösteriminde ham formül yerine motorun hesapladığı değer kullanılır.
- Motorun `valuesUpdated` olayı → grid ilgili hücreleri yeniden çizer.
- Undo/redo, kopyala/yapıştır ve autofill motorun kendi operasyonlarına iletilir.

## 3. CenituTable MVP tasarımı

İki bağımsız paket gibi tasarlanır; grid formül motoruna yalnızca bir arayüz üzerinden bağlanır.

### 3.1 `formula/` — CenituCalc motoru

Public API (yaygın formül motoru API'leriyle ad uyumlu):

```ts
class FormulaEngine {
  static buildFromArray(data: RawCell[][]): FormulaEngine
  setCellContents(addr: CellAddress, content: RawCell | RawCell[][]): ChangedCell[]
  getCellValue(addr): CellValue          // number | string | boolean | null | CellError
  getCellFormula(addr): string | undefined
  getCellSerialized(addr): RawCell
  getSheetValues(): CellValue[][]
  getSheetDimensions(): { width; height }
  calculateFormula(formula: string): CellValue
  batch(fn: () => void): ChangedCell[]
  addRows(index, count) / removeRows(index, count)
  addColumns(index, count) / removeColumns(index, count)
  getCellPrecedents(addr) / getCellDependents(addr)
  on('valuesUpdated', cb)
  static registerFunction(name, impl)
}
```

Bileşenler:
1. **Lexer**: sayı, string, boolean, hata literal'leri (`#DIV/0!`), hücre ref (`A1`, `$A$1`), aralık,
   fonksiyon adı, operatörler (`+ - * / ^ & = <> < <= > >= %`), `( ) , ;`.
2. **Parser**: öncelik tabanlı (Pratt) ayrıştırıcı → AST.
   Öncelik: karşılaştırma < `&` < `+ -` < `* /` < `^` < tekli `-`/`+` < yüzde `%`.
3. **Dependency graph**: hücre → bağımlı hücreler kümesi. Aralık bağımlılıkları için aralık düğümü
   (MVP: aralık başına bir kayıt + adres yoklaması).
4. **Recalc**: değişen hücreden bağımlılara doğru kirli küme toplanır, Kahn algoritmasıyla
   topolojik sıralanır. Sıralanamayan düğümler döngüdür → `#CYCLE!`.
5. **Interpreter**: AST yürütme, Excel tip zorlama kuralları, aralık değerleri 2B dizi.
6. **Fonksiyonlar (MVP)**: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, IFERROR, AND, OR, NOT,
   ROUND, ABS, CONCAT/CONCATENATE, LEN, UPPER, LOWER, VLOOKUP, HLOOKUP, INDEX, MATCH, SUMIF, COUNTIF.
7. **Hatalar**: `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`, `#ERROR!` (parse), `#CYCLE!`.
8. **Satır/sütun ekleme-silme**: formüllerdeki referanslar kaydırılır, silinen hücreye referans `#REF!` olur.

#### 3.1.1 Çok sayfa, isimli ifadeler, artımlı yapı değişiklikleri, tarihler

```ts
interface CellAddress { row: number; col: number; sheet?: number }   // sheet yoksa 0
cellKey(row, col, sheet = 0)  // sheet * 2^34 + row * 2^14 + col  (< 2^53, ~500k sayfa)

class FormulaEngine {
  static buildFromArray(data, sheetName = 'Sheet1'): FormulaEngine
  static buildFromSheets(sheets: Record<string, RawCell[][]>): FormulaEngine   // id'ler 0,1,… sırayla
  addSheet(name?): number              // varsayılan "SheetN"; ad büyük/küçük harf duyarsız, tekil
  removeSheet(id): ChangedCell[]       // o sayfaya referanslar #REF! olur, bağımlılar yeniden hesaplanır
  renameSheet(id, newName): void       // formül metinleri her yerde güncellenir
  getSheetNames(): string[]; getSheetId(name); getSheetName(id); doesSheetExist(name); countSheets()
  // Sayfa kapsamlı metotlar sonda isteğe bağlı `sheet = 0` alır:
  getSheetValues(sheet?) / getSheetSerialized(sheet?) / getSheetDimensions(sheet?)
  setSheetContent(data, sheet?) / calculateFormula(formula, sheet?)
  addRows(index, count, sheet?) / removeRows(…) / addColumns(…) / removeColumns(…): ChangedCell[]
  // İsimli ifadeler (global):
  addNamedExpression(name, expression: RawCell)        // değer veya '=Sheet1!$A$1:$A$10', '=0.2*2'
  changeNamedExpression(name, expression) / removeNamedExpression(name)
  getNamedExpressionValue(name): CellValue | CellValue[][] | undefined
  getNamedExpressionFormula(name): RawCell | undefined
  listNamedExpressions(): string[]
  isItPossibleToAddNamedExpression(name): boolean
}
interface ChangedCell { address: { row; col; sheet }; value: CellValue }
```

- **Sözdizimi**: `Sheet2!A1`, `Sheet2!A1:B3`, `'My Sheet'!$A$1` (`''` tırnak kaçışı). Bilinmeyen sayfa → `#REF!`;
  o adda sayfa sonradan eklenir/yeniden adlandırılırsa formül yeniden çözülür. İki sayfaya yayılan aralık sözdizimi hatasıdır.
- **İsimler**: geçerli tanımlayıcı (Unicode harf/rakam/`_`/`.`), hücre referansı (`A1`, `Tax2024`), TRUE/FALSE
  veya kayıtlı fonksiyon adı olamaz; büyük/küçük harf duyarsız tekildir. Formüllerde her yerde kullanılır;
  aralığa çözülen isim fonksiyon içinde aralık gibi davranır. Tanımsız isim → `#NAME?` (tanımlanınca hesaplanır).
  İsim ifadesindeki sayfasız referanslar ilk sayfaya bağlanır; yapı değişiklikleri isimlerdeki aralıkları da günceller.
  İsim grafikte bir düğümdür: isim veya hücreleri değişince onu kullanan formüller yeniden hesaplanır.
- **Artımlı yapı değişikliği**: AST'de göreli referanslar formül hücresine göre ofset olarak tutulur, grafik
  kenarları anahtar değil kayıt (vertex) nesnelerine bağlıdır. Satır/sütun ekleme-silmede AST'ler yerinde
  düzeltilir (yeniden ayrıştırma yok), kayıtlar yeni anahtarlara taşınır, formül metni yalnızca hedefi kayanlar
  için okunurken tembel üretilir. Yalnızca anlamı değişen formüller (`#REF!` oldu, aralık büyüdü/küçüldü)
  ve bağımlıları yeniden hesaplanır. 70k formüllü sayfada tek satır ekleme/silme ≈ 35–45 ms (önce ≈ 380–410 ms).
- **Tarihler** (`dates.ts`, 1900 sistemi; 1 = 1900-01-01, 60 = hayali 1900-02-29, 25569 = 1970-01-01):
  `dateToSerial(y, m, d)`, `serialToDate(serial)`, `parseDateString(text)` ('YYYY-MM-DD', 'DD.MM.YYYY',
  'DD/MM/YYYY'; gerçek takvim doğrulaması), `formatSerialDate(serial, pattern = 'YYYY-MM-DD')`
  (YYYY YY MM M DD D HH mm ss). Fonksiyonlar: DATE, YEAR, MONTH, DAY, TODAY, NOW, WEEKDAY (tip 1/2/3), EDATE,
  EOMONTH, DAYS, DATEDIF ("Y", "M", "D", "YM"). Tarih argümanları seri sayı veya yukarıdaki biçimlerde metin olabilir.
  TODAY/NOW formül yeniden hesaplandığında güncellenir (otomatik "volatile" yenileme yok).

### 3.2 `grid/` — CenituGrid

Public API (yaygın grid API'leriyle ad uyumlu). Satır indeksleri **görseldir** (ekranda görünen sıra);
`toPhysicalRow` / `toVisualRow` dönüşüm yapar. Değişiklik olaylarında hem `row` (görsel) hem
`physicalRow` (veri/formül satırı) bulunur.

```ts
new CenituGrid(container, {
  data, minRows, minCols, rowHeaders, colHeaders, colWidths, rowHeight, height, theme,
  formulas: boolean | FormulaEngine, sheetName,           // paylaşılan motor: sayfa başına bir grid
  columns: CellMeta[], cells: (physicalRow, col) => CellMeta,
  fixedRowsTop, fixedColumnsStart, mergeCells, columnSorting, filters, fillHandle,
  readOnly, locale, language,
})
getDataAtCell / getSourceDataAtCell / setDataAtCell / getData / getSourceData / loadData
selectCell / getSelected / getSelectedRange / deselectCell
sort(col, 'asc' | 'desc' | null) / getSortState()
setFilter(col, ColumnFilter | null) / clearFilters() / getFilters() / applyFilters()
mergeCells(r, c, rowspan, colspan) / unmergeCells(r, c) / getMergedCells()
autofill(sourceRange, targetRange) / copy(cut?) / paste(text)
alter(action, index?, amount?) / undo() / redo()
getCellMeta / setCellMeta / getCellError / updateSettings(subset)
addHook / removeHook  // beforeChange, afterChange, afterSelection, afterAlter,
                      // afterColumnSort, afterFilter, afterAutofill, afterValidate
```

`CellMeta`: `type` (`text | numeric | date | checkbox | dropdown`), `numericFormat` (Intl),
`dateFormat`, `source`/`strict` (dropdown), `validator` (fonksiyon veya RegExp), `allowInvalid`,
`readOnly`, `className`, `renderer`, `title`, `width`.

Mimari:
- **RowMapper**: görsel → fiziksel satır eşlemesi. Sıralama sırayı, filtre gizli kümeyi değiştirir;
  veri ve formüller hiç taşınmaz. Sabit üst satırlar (`fixedRowsTop`) sıralama/filtre dışıdır.
  Satır başlıkları fiziksel numarayı gösterir (formül referanslarıyla tutarlı, Excel filtresi gibi).
- **Dört bölme**: köşe (sabit satır+sütun), üst, sol ve kayan ana bölme; hepsi `position: sticky`.
  Hücre/başlık elemanları bölme başına havuzlanır, yalnızca görünür pencere çizilir.
- **Birleştirilmiş hücreler** görsel koordinatlardadır; sıralama/filtre etkinken devre dışıdır,
  sabit bölme sınırını aşamaz. Seçim birleşimleri kapsayacak şekilde genişler.
- **Kalıcı editör**: her zaman odakta duran gizli bir textarea; ilk `input`/`compositionstart`
  olayında görünür editöre dönüşür (IME ve dikte uyumlu).
- **Geri alma**: hücre değişiklikleri değişiklik listesi olarak; yapısal değişiklikler motor
  işlemleri olarak saklanır. Silmenin tersi `engine.restoreRemoval` ile yapılır; bu, başka
  sayfalarda `#REF!`'e dönen formülleri ve isimli ifadeleri de geri getirir.
- **Doldurma tutamacı**: sayılarda sabit adımlı seri, "Ürün 7" gibi metinlerde sayaç, formüllerde
  fiziksel satır farkına göre göreli kaydırma, diğerlerinde tekrar. Çift tıklama komşu sütunun
  verisi bitene kadar doldurur; Ctrl+D aşağı doldurur.

## 4. Kapsam dışı (sonraki fazlar)

Dizi formülleri ve 3B aralıklar (`Sheet1:Sheet3!A1`), sayfa kapsamlı isimler, volatile yeniden
hesaplama (TODAY/NOW), satır yüksekliği değiştirme, sütun taşıma/gizleme, context menu,
koşullu biçimlendirme, Vue/Angular sarmalayıcıları.
