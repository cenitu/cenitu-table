import { describe, expect, it } from 'vitest';
import { fetchAllPages, queryToParams, type ServerQuery } from '../src';

const base: ServerQuery = { page: 2, pageSize: 50, sort: [], filters: {} };

describe('queryToParams', () => {
  it('writes page and size', () => {
    expect(queryToParams(base).toString()).toBe('page=2&pageSize=50');
  });

  it('uses the first sort key and the column name given', () => {
    const q = { ...base, sort: [{ field: 'date', desc: true }, { field: 'no', desc: false }] };
    const p = queryToParams(q, { names: { date: 'orderDate' } });
    expect(p.get('sortBy')).toBe('orderDate');
    expect(p.get('sortDescending')).toBe('true');
  });

  it('writes every filter kind', () => {
    const p = queryToParams({
      ...base,
      search: 'vida',
      filters: {
        name: { kind: 'text', value: 'a b' },
        status: { kind: 'list', values: ['Open', 'Closed'] },
        date: { kind: 'date', from: '2026-01-01', to: '2026-02-01' },
        amount: { kind: 'number', min: 0, max: 10 },
        paid: { kind: 'boolean', value: false },
      },
    });
    expect(p.get('search')).toBe('vida');
    expect(p.get('name')).toBe('a b');
    expect(p.getAll('status')).toEqual(['Open', 'Closed']);
    expect(p.get('dateFrom')).toBe('2026-01-01');
    expect(p.get('dateTo')).toBe('2026-02-01');
    expect(p.get('amountMin')).toBe('0');
    expect(p.get('amountMax')).toBe('10');
    expect(p.get('paid')).toBe('false');
  });

  it('leaves out open ends of ranges', () => {
    const p = queryToParams({ ...base, filters: { date: { kind: 'date', to: '2026-02-01' } } });
    expect(p.has('dateFrom')).toBe(false);
  });
});

describe('fetchAllPages', () => {
  const server = (total: number, withTotal = true) => {
    const asked: number[] = [];
    const fetchPage = async (q: ServerQuery) => {
      asked.push(q.page);
      const start = (q.page - 1) * q.pageSize;
      const items = Array.from({ length: Math.max(0, Math.min(q.pageSize, total - start)) }, (_, i) => start + i);
      return withTotal ? { items, totalCount: total } : { items };
    };
    return { asked, fetchPage };
  };

  it('collects all pages in order', async () => {
    const s = server(5);
    expect(await fetchAllPages(s.fetchPage, base, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(s.asked).toEqual([1, 2, 3]);
  });

  it('does not ask for an empty page when the total is known', async () => {
    const s = server(4);
    await fetchAllPages(s.fetchPage, base, 2);
    expect(s.asked).toEqual([1, 2]);
  });

  it('ends on an empty page without totals', async () => {
    const s = server(4, false);
    expect(await fetchAllPages(s.fetchPage, base, 2)).toHaveLength(4);
    expect(s.asked).toEqual([1, 2, 3]);
  });
});
