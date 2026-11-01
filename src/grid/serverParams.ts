import type { ServerFilter, ServerQuery } from './serverMode';

export interface QueryParamOptions {
  /** Request parameter of a column id, when the two differ. */
  names?: Record<string, string>;
  /** Parameter holding the sort field. Default "sortBy". */
  sortBy?: string;
  /** Parameter holding the sort direction. Default "sortDescending". */
  sortDescending?: string;
}

function appendFilter(params: URLSearchParams, name: string, filter: ServerFilter): void {
  if (filter.kind === 'text') params.append(name, filter.value);
  else if (filter.kind === 'boolean') params.append(name, String(filter.value));
  else if (filter.kind === 'list') filter.values.forEach((v) => params.append(name, v));
  else if (filter.kind === 'date') {
    if (filter.from) params.append(`${name}From`, filter.from);
    if (filter.to) params.append(`${name}To`, filter.to);
  } else {
    if (filter.min !== undefined) params.append(`${name}Min`, String(filter.min));
    if (filter.max !== undefined) params.append(`${name}Max`, String(filter.max));
  }
}

/**
 * Query as request parameters for the common REST shape: `page`, `pageSize`, the first sort key as
 * `sortBy` and `sortDescending`, `search`, then one parameter per filter. Lists repeat their
 * parameter; date ranges become `{name}From` and `{name}To`, numbers `{name}Min` and `{name}Max`.
 */
export function queryToParams(query: ServerQuery, opts: QueryParamOptions = {}): URLSearchParams {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  const name = (field: string) => opts.names?.[field] ?? field;
  const sort = query.sort[0];
  if (sort) {
    params.set(opts.sortBy ?? 'sortBy', name(sort.field));
    params.set(opts.sortDescending ?? 'sortDescending', String(sort.desc));
  }
  if (query.search) params.set('search', query.search);
  for (const [field, filter] of Object.entries(query.filters)) appendFilter(params, name(field), filter);
  return params;
}

/**
 * Reads every page of a query, for `fetchAllRows`. With `totalCount` it stops there, since a server
 * may cap page sizes below `pageSize`; without it, at a short page.
 */
export async function fetchAllPages<T>(
  fetchPage: (query: ServerQuery) => Promise<{ items: T[]; totalCount?: number }>,
  query: ServerQuery,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const { items, totalCount } = await fetchPage({ ...query, page, pageSize });
    rows.push(...items);
    const done = totalCount === undefined ? items.length < pageSize : rows.length >= totalCount;
    if (done || !items.length) return rows;
  }
}
