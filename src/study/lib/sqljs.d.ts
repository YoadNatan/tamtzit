// The part of sql.js the Anki export uses (spec §5.5; research-anki §1). The
// sql.js package ships no types, and @types/sql.js would pull @types/node into
// the browser build's types.
declare module "sql.js" {
  export interface Statement {
    run(params?: unknown[]): void;
    free(): boolean;
  }
  export interface QueryResult {
    columns: string[];
    values: unknown[][];
  }
  export interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string, params?: unknown[]): QueryResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
