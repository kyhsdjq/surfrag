import { z } from "zod";
export declare const captureIngestSchema: z.ZodObject<{
    pageId: z.ZodString;
    title: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    url: z.ZodURL;
    referrer: z.ZodDefault<z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>;
    bodyText: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    maxScrollPercentage: z.ZodDefault<z.ZodNumber>;
    capturedAt: z.ZodOptional<z.ZodISODateTime>;
    sourceSession: z.ZodDefault<z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>;
}, z.core.$strict>;
export type CaptureIngestInput = z.input<typeof captureIngestSchema>;
export type CaptureIngest = z.output<typeof captureIngestSchema>;
export declare const captureRecordSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    title: z.ZodString;
    url: z.ZodURL;
    referrer: z.ZodString;
    bodyText: z.ZodString;
    maxScrollPercentage: z.ZodNumber;
    capturedAt: z.ZodISODateTime;
    sourceSession: z.ZodString;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type CaptureRecord = z.infer<typeof captureRecordSchema>;
export declare const normalizeCaptureIngest: (input: CaptureIngestInput) => {
    pageId: string;
    title: string;
    url: string;
    referrer: string;
    bodyText: string;
    maxScrollPercentage: number;
    sourceSession: string;
    capturedAt?: string | undefined;
};
export declare const toCaptureRecord: (input: CaptureIngestInput, nowIso?: string) => CaptureRecord;
//# sourceMappingURL=capture.d.ts.map