import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';

export interface Query {
  table: string;
  params: unknown[];
}

export const database = {
  available: true,
  queries: [] as Query[],
  read: async (_query: Query): Promise<unknown[]> => [],
};

// Execute on await, like Drizzle. Tests control completion to expose duplicate
// overlapping reads without a production connection or timing thresholds.
export function tryGetDb() {
  if (!database.available) return null;
  return {
    select: () => ({
      from: (table: PgTable) => ({
        where: (condition: SQL) => {
          const query = { table: getTableName(table), params: new PgDialect().sqlToQuery(condition).params };
          const builder = {
            orderBy: (_order: SQL) => builder,
            limit: (_limit: number) => builder,
            then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
              database.queries.push(query);
              return database.read(query).then(resolve, reject);
            },
          };
          return builder;
        },
      }),
    }),
  };
}
