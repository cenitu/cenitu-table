export interface Messages {
  sortAsc: string;
  sortDesc: string;
  sortClear: string;
  sortThenAsc: string;
  sortThenDesc: string;
  filterByCondition: string;
  filterByValue: string;
  search: string;
  selectAll: string;
  blanks: string;
  ok: string;
  cancel: string;
  clearFilter: string;
  none: string;
  contains: string;
  notContains: string;
  equals: string;
  notEquals: string;
  greaterThan: string;
  greaterOrEqual: string;
  lessThan: string;
  lessOrEqual: string;
  isEmpty: string;
  isNotEmpty: string;
  columnMenu: string;
  cut: string;
  copy: string;
  paste: string;
  insertRowAbove: string;
  insertRowBelow: string;
  removeRow: string;
  removeRows: string;
  insertColLeft: string;
  insertColRight: string;
  removeCol: string;
  removeCols: string;
  mergeCells: string;
  unmergeCells: string;
  clearContents: string;
  undo: string;
  redo: string;
  hideColumn: string;
  hideColumns: string;
  showColumns: string;
  cellAnnouncement: string;
  find: string;
  replace: string;
  replaceAll: string;
  replaceWith: string;
  matchCase: string;
  wholeCell: string;
  lookInFormulas: string;
  noMatches: string;
  /** {total} is the number of matches. */
  matchCount: string;
  /** {count} is the number of cells changed. */
  replacedCount: string;
  next: string;
  previous: string;
  close: string;
  formulaBar: string;
  /** {from}, {to} and {total} are record numbers. */
  pagerRange: string;
  pageSize: string;
  noRows: string;
  noOptions: string;
  loading: string;
  loadError: string;
  dateFrom: string;
  dateTo: string;
  yes: string;
  no: string;
}

export const enUS: Messages = {
  sortAsc: 'Sort A → Z',
  sortDesc: 'Sort Z → A',
  sortClear: 'Clear sort',
  sortThenAsc: 'Then sort A → Z',
  sortThenDesc: 'Then sort Z → A',
  filterByCondition: 'Filter by condition',
  filterByValue: 'Filter by value',
  search: 'Search',
  selectAll: '(Select all)',
  blanks: '(Blanks)',
  ok: 'OK',
  cancel: 'Cancel',
  clearFilter: 'Clear filter',
  none: 'None',
  contains: 'Contains',
  notContains: 'Does not contain',
  equals: 'Is equal to',
  notEquals: 'Is not equal to',
  greaterThan: 'Greater than',
  greaterOrEqual: 'Greater than or equal to',
  lessThan: 'Less than',
  lessOrEqual: 'Less than or equal to',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty',
  columnMenu: 'Column menu',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  removeRow: 'Delete row',
  removeRows: 'Delete rows',
  insertColLeft: 'Insert column left',
  insertColRight: 'Insert column right',
  removeCol: 'Delete column',
  removeCols: 'Delete columns',
  mergeCells: 'Merge cells',
  unmergeCells: 'Unmerge cells',
  clearContents: 'Clear contents',
  undo: 'Undo',
  redo: 'Redo',
  hideColumn: 'Hide column',
  hideColumns: 'Hide columns',
  showColumns: 'Show hidden columns',
  cellAnnouncement: '{cell}: {value}',
  find: 'Find',
  replace: 'Replace',
  replaceAll: 'Replace all',
  replaceWith: 'Replace with',
  matchCase: 'Match case',
  wholeCell: 'Whole cell',
  lookInFormulas: 'In formulas',
  noMatches: 'No matches',
  matchCount: '{total} matches',
  replacedCount: '{count} replaced',
  next: 'Next',
  previous: 'Previous',
  close: 'Close',
  formulaBar: 'Cell content',
  pagerRange: '{from}–{to} of {total}',
  pageSize: 'Rows per page',
  noRows: 'No records',
  noOptions: 'No results',
  loading: 'Loading…',
  loadError: 'Could not load the data',
  dateFrom: 'From',
  dateTo: 'To',
  yes: 'Yes',
  no: 'No',
};

export const trTR: Messages = {
  sortAsc: 'A → Z sırala',
  sortDesc: 'Z → A sırala',
  sortClear: 'Sıralamayı kaldır',
  sortThenAsc: 'Sonra A → Z sırala',
  sortThenDesc: 'Sonra Z → A sırala',
  filterByCondition: 'Koşula göre filtrele',
  filterByValue: 'Değere göre filtrele',
  search: 'Ara',
  selectAll: '(Tümünü seç)',
  blanks: '(Boş)',
  ok: 'Tamam',
  cancel: 'İptal',
  clearFilter: 'Filtreyi temizle',
  none: 'Yok',
  contains: 'İçerir',
  notContains: 'İçermez',
  equals: 'Eşittir',
  notEquals: 'Eşit değildir',
  greaterThan: 'Büyüktür',
  greaterOrEqual: 'Büyük veya eşittir',
  lessThan: 'Küçüktür',
  lessOrEqual: 'Küçük veya eşittir',
  isEmpty: 'Boş',
  isNotEmpty: 'Boş değil',
  columnMenu: 'Sütun menüsü',
  cut: 'Kes',
  copy: 'Kopyala',
  paste: 'Yapıştır',
  insertRowAbove: 'Üste satır ekle',
  insertRowBelow: 'Alta satır ekle',
  removeRow: 'Satırı sil',
  removeRows: 'Satırları sil',
  insertColLeft: 'Sola sütun ekle',
  insertColRight: 'Sağa sütun ekle',
  removeCol: 'Sütunu sil',
  removeCols: 'Sütunları sil',
  mergeCells: 'Hücreleri birleştir',
  unmergeCells: 'Birleştirmeyi kaldır',
  clearContents: 'İçeriği temizle',
  undo: 'Geri al',
  redo: 'Yinele',
  hideColumn: 'Sütunu gizle',
  hideColumns: 'Sütunları gizle',
  showColumns: 'Gizli sütunları göster',
  cellAnnouncement: '{cell}: {value}',
  find: 'Bul',
  replace: 'Değiştir',
  replaceAll: 'Tümünü değiştir',
  replaceWith: 'Yeni değer',
  matchCase: 'Büyük/küçük harf',
  wholeCell: 'Hücrenin tamamı',
  lookInFormulas: 'Formüllerde',
  noMatches: 'Sonuç yok',
  matchCount: '{total} sonuç',
  replacedCount: '{count} değiştirildi',
  next: 'Sonraki',
  previous: 'Önceki',
  close: 'Kapat',
  formulaBar: 'Hücre içeriği',
  pagerRange: '{from}–{to} / {total}',
  pageSize: 'Sayfa başına satır',
  noRows: 'Kayıt yok',
  noOptions: 'Sonuç yok',
  loading: 'Yükleniyor…',
  loadError: 'Veri yüklenemedi',
  dateFrom: 'Başlangıç',
  dateTo: 'Bitiş',
  yes: 'Evet',
  no: 'Hayır',
};
