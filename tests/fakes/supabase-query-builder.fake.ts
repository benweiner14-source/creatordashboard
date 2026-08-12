export interface FakeRow {
  [key: string]: unknown;
}

export function createFakeSupabaseClient(initialRows: Record<string, FakeRow[]> = {}) {
  const tables: Record<string, FakeRow[]> = { ...initialRows };

  return {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      return {
        select(_columns: string, _opts?: { count?: string; head?: boolean }) {
          const filters: Array<(row: FakeRow) => boolean> = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return builder;
            },
            gte(column: string, value: unknown) {
              filters.push((row) => (row[column] as string) >= (value as string));
              return builder;
            },
            then(resolve: (result: { count: number; error: null }) => void) {
              const matched = rows.filter((row) => filters.every((f) => f(row)));
              resolve({ count: matched.length, error: null });
            },
          };
          return builder;
        },
        insert(row: FakeRow) {
          rows.push({ id: `${rows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
    __getRows(table: string) {
      return tables[table] ?? [];
    },
  };
}
