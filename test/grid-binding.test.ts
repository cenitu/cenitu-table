import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, type GridOptions } from '../src';
import { isObjectData, ObjectBinding } from '../src/grid/binding';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

const orders = () => [
  { product: 'Vida', qty: 10, price: 2.5, customer: { name: 'Acme' } },
  { product: 'Somun', qty: 4, price: 1.25, customer: { name: 'Beta' } },
];

describe('ObjectBinding', () => {
  it('detects object data and reads nested paths', () => {
    expect(isObjectData(orders())).toBe(true);
    expect(isObjectData([[1, 2]])).toBe(false);
    expect(isObjectData([])).toBe(false);
    const b = ObjectBinding.create(orders(), ['product', 'customer.name', undefined]);
    expect(b.toRows()).toEqual([['Vida', 'Acme', null], ['Somun', 'Beta', null]]);
  });

  it('derives fields from the first object and converts dates to serials', () => {
    const b = ObjectBinding.create([{ a: 1, d: new Date(2026, 9, 30), x: { y: 1 } }], []);
    expect(b.fields).toEqual(['a', 'd', 'x']);
    expect(b.toRows()[0]).toEqual([1, 46325, '[object Object]']);
  });
});

describe('grid with object data', () => {
  it('binds columns by property, writes edits back and creates nested objects', () => {
    const data = orders();
    const g = make({
      data,
      columns: [{ data: 'product' }, { data: 'qty', type: 'numeric' }, { data: 'price' }, { data: 'customer.name' }, { title: 'Total' }],
    });
    expect(g.getData()[0]).toEqual(['Vida', 10, 2.5, 'Acme', null]);
    g.setDataAtCell(0, 4, '=B1*C1');
    expect(g.getDataAtCell(0, 4)).toBe(25);
    expect(data[0]).not.toHaveProperty('Total'); // unbound column is not written back
    g.setDataAtCell(1, 1, 8);
    expect(data[1].qty).toBe(8);
    g.setDataAtCell(1, 3, 'Gamma');
    expect(data[1].customer.name).toBe('Gamma');
    expect(g.getSourceObjects()).toBe(data);
    expect(g.colToProp(1)).toBe('qty');
    expect(g.propToCol('price')).toBe(2);
  });

  it('reports the bound prop in change events and uses field names as default headers', () => {
    const g = make({ data: orders() });
    const props: (string | undefined)[] = [];
    g.addHook('afterChange', (changes) => props.push(...changes.map((c) => c.prop)));
    g.setDataAtCell(0, 1, 11);
    expect(props).toEqual(['qty']);
    const labels = [...g.root.querySelectorAll('.ct-colhead .ct-label')].map((e) => e.textContent);
    expect(labels.slice(0, 4)).toEqual(['product', 'qty', 'price', 'customer']);
  });

  it('keeps the object array in sync on insert/remove/paste growth and undo', () => {
    const data = orders();
    const g = make({ data, columns: [{ data: 'product' }, { data: 'qty' }], dataSchema: () => ({ product: '', qty: 0 }) });
    g.alter('insert_row_below', 0);
    expect(data).toHaveLength(3);
    expect(data[1]).toEqual({ product: '', qty: 0 });
    g.setDataAtCell(1, 0, 'Pul');
    expect(data[1].product).toBe('Pul');
    g.alter('remove_row', 0);
    expect(data.map((o) => o.product)).toEqual(['Pul', 'Somun']);
    g.undo();
    expect(data.map((o) => o.product)).toEqual(['Vida', 'Pul', 'Somun']);
    g.selectCell(2, 0);
    g.paste('A\t1\nB\t2');
    expect(data).toHaveLength(4);
    expect(data[3]).toEqual({ product: 'B', qty: 2 });
  });

  it('sorting does not reorder the source objects', () => {
    const data = orders();
    const g = make({ data, columns: [{ data: 'product' }, { data: 'qty' }] });
    g.sort(1, 'asc');
    expect(g.getDataAtCell(0, 0)).toBe('Somun');
    g.setDataAtCell(0, 1, 99);
    expect(data[1].qty).toBe(99);
    expect(data[0].product).toBe('Vida');
  });
});

describe('formulas in bound columns', () => {
  const rows = () => [{ qty: 2, price: 5, total: null as unknown }, { qty: 3, price: 4, total: null as unknown }];
  const columns = [{ data: 'qty' }, { data: 'price' }, { data: 'total' }];

  it('writes computed values and keeps them current, also from loaded formulas', () => {
    const data = rows();
    data[1].total = '=A2*B2';
    const g = make({ data, columns });
    expect(data[1].total).toBe(12); // loaded formula resolved
    g.setDataAtCell(0, 2, '=A1*B1');
    expect(data[0].total).toBe(10);
    g.setDataAtCell(0, 0, 4);
    expect(data[0].total).toBe(20); // dependent recalculated
    expect(g.getSourceDataAtCell(0, 2)).toBe('=A1*B1'); // the grid keeps the formula
    g.setDataAtCell(0, 1, 0);
    g.setDataAtCell(0, 2, '=A1/B1');
    expect(data[0].total).toBeNull(); // errors never reach the object
  });

  it('stores formula text with bindFormulas: "text"', () => {
    const data = rows();
    const g = make({ data, columns, bindFormulas: 'text' });
    g.setDataAtCell(0, 2, '=A1*B1');
    expect(data[0].total).toBe('=A1*B1');
  });

  it('stays correct through structural undo', () => {
    const data = rows();
    const g = make({ data, columns });
    g.setDataAtCell(1, 2, '=A2*B2');
    g.alter('insert_row_above', 0);
    expect(data[2].total).toBe(12);
    g.undo();
    expect(data).toHaveLength(2);
    expect(data[1].total).toBe(12);
    expect(data[0].total).toBeNull();
    g.setDataAtCell(1, 0, 10);
    expect(data[1].total).toBe(40);
  });

  it('getBoundRows matches what the objects hold', () => {
    const data = rows();
    const g = make({ data, columns });
    g.setDataAtCell(0, 2, '=A1*B1');
    expect(g.getBoundRows()[0]).toEqual([2, 5, 10]);
  });
});
