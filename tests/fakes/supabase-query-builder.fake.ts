export interface FakeRow {
  [key: string]: unknown;
}

export type FakeRpcHandler = (params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export function createFakeSupabaseClient(
  initialRows: Record<string, FakeRow[]> = {},
  rpcHandlers: Record<string, FakeRpcHandler> = {}
) {
  const tables: Record<string, FakeRow[]> = { ...initialRows };

  return {
    async rpc(name: string, params: Record<string, unknown>) {
      const handler = rpcHandlers[name];
      if (!handler) {
        throw new Error(`No fake RPC handler registered for "${name}"`);
      }
      return handler(params);
    },
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
