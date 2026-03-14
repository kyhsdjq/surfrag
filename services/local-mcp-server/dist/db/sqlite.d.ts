import Database from "better-sqlite3";
import type { CaptureRecord } from "../schema/capture.js";
export type SqliteBootstrapResult = {
    db: Database.Database;
    dbPath: string;
};
export declare const resolveDbPath: (dbPath?: string | undefined) => string;
export declare const bootstrapSqlite: (dbPath?: string | undefined) => SqliteBootstrapResult;
export declare const upsertCapture: (db: Database.Database, capture: CaptureRecord) => {
    id: string;
    changes: number;
};
//# sourceMappingURL=sqlite.d.ts.map