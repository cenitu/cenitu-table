# Connecting a server-paged list

This guide moves an existing list screen, one that fetches pages from a REST endpoint, onto
CenituTable. The grid never sorts or filters by itself in server mode. It tells you what it needs,
and your code fetches.

## The contract

The grid reports a `ServerQuery`, keyed by column ids:

```ts
{
  page: 1,
  pageSize: 50,
  sort: [{ field: 'orderDate', desc: true }],
  filters: { status: { kind: 'list', values: ['Open'] } },
  search: 'vida',
  requestId: 12,
}
```

`queryToParams` turns it into the usual request parameters:

| Query | Parameters |
| --- | --- |
| `page`, `pageSize`, `search` | same names |
| First sort key | `sortBy`, `sortDescending` |
| `text`, `boolean` filter | `{name}=value` |
| `list` filter | `{name}` repeated |
| `date` filter | `{name}From`, `{name}To` |
| `number` filter | `{name}Min`, `{name}Max` |

Pass `names` when a column id differs from its parameter, and `sortBy` or `sortDescending` when
your API spells those differently. For any other shape, read the query directly.

## React

```tsx
import { useEffect, useState } from 'react';
import { queryToParams, fetchAllPages, type ServerQuery } from 'cenitu-table';
import { CenituTable } from 'cenitu-table/react';

const columns = [
  { id: 'orderDate', data: 'orderDate', title: 'Date', type: 'date', sortable: true,
    serverFilter: { kind: 'date' } },
  { id: 'status', data: 'status', title: 'Status', sortable: true,
    serverFilter: { kind: 'list', options: [{ value: 'Open' }, { value: 'Closed' }] } },
  { id: 'partner', data: 'partner.name', title: 'Partner' },
];

const fetchPage = (q: ServerQuery) =>
  fetch(`/api/orders?${queryToParams(q)}`).then((r) => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });

export function Orders() {
  const [query, setQuery] = useState<ServerQuery>({ page: 1, pageSize: 50, sort: [], filters: {} });
  const [page, setPage] = useState({ items: [], totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPage(query).then(
      (result) => { setPage(result); setError(false); setLoading(false); },
      () => { setError(true); setLoading(false); },
    );
  }, [query]);

  return (
    <CenituTable
      dataMode="server"
      rowKey="id"
      columns={columns}
      data={page.items}
      totalCount={page.totalCount}
      dataRequestId={query.requestId}
      loading={loading}
      loadError={error}
      query={query}
      onQueryChange={setQuery}
      fetchAllRows={(q) => fetchAllPages(fetchPage, q)}
      onRowDoubleClick={(e) => { openOrder(e.rowKey); return false; }}
    />
  );
}
```

`dataRequestId` makes a late answer harmless: rows from an older query are refused. The old rows
stay on screen, dimmed, until the new ones arrive.

## Without React

```ts
const grid = new CenituGrid(el, { dataMode: 'server', rowKey: 'id', columns });

async function load(query: ServerQuery) {
  const { items, totalCount } = await fetchPage(query);
  grid.setPageRows(items, totalCount, { requestId: query.requestId });
}

grid.addHook('afterQueryChange', load);
load(grid.getQuery()!);
```

## Unsaved edits

Edits arrive through `afterChange` with the row's `rowKey`. To warn before leaving a page with
unsaved work, return false from `beforeQueryChange` (`onBeforeQueryChange` in React). The controls
go back to the current query.

```ts
grid.addHook('beforeQueryChange', () => !hasUnsavedEdits() || confirm('Discard changes?'));
```

Undo history ends when a new page arrives, because its entries refer to rows that are gone.

## Adding and removing rows

Rows belong to the server, so `alter` leaves them alone in server mode and the context menu hides
those entries. Give the grid `rowActions` to bring them back. Each action runs your request and
then asks for the page again, which keeps the total and the page right:

```ts
new CenituGrid(el, {
  dataMode: 'server',
  rowActions: {
    create: async () => { await api.createOrder(); },
    remove: async (rows) => { await api.deleteOrders(rows.map((r) => r.id)); },
  },
});
```

## Choosing what to check first

1. Sorting and filtering on a column your API supports. Columns without `sortable` or
   `serverFilter` show no control at all.
2. Page size change and a filter while on a later page: both return to page 1.
3. A slow answer followed by a fast one: the slow answer must not replace the page.
4. An empty result, then a failing request.
5. Exporting the full result with `downloadAllXLSX`.
