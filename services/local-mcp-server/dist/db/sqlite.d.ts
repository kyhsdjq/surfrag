import Database from "better-sqlite3";
import type { CaptureRecord } from "../schema/capture.js";
export type SqliteBootstrapResult = {
    db: Database.Database;
    dbPath: string;
};
export type SearchCaptureMatch = {
    id: string;
    title: string;
    url: string;
    capturedAt: string;
    snippet: string;
    keywordCount: number;
};
export declare const resolveDbPath: (dbPath?: string | undefined) => string;
export declare const bootstrapSqlite: (dbPath?: string | undefined) => SqliteBootstrapResult;
export declare const upsertCapture: (db: Database.Database, capture: CaptureRecord) => {
    id: string;
    changes: number;
};
export declare const searchCaptures: (db: Database.Database, keyword: string, limit: number, since?: string) => {
    matches: SearchCaptureMatch[];
    totalMatches: number;
};
export declare const getCaptureById: (db: Database.Database, id: string) => {
    id: string;
    pageId: string;
    title: string;
    url: string;
    referrer: string;
    bodyText: string;
    maxScrollPercentage: number;
    capturedAt: string;
    sourceSession: string;
    createdAt: string;
    updatedAt: string;
} | null;
//# sourceMappingURL=sqlite.d.ts.map