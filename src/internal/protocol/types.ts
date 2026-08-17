export const SHARD_MAGIC = 0xFF;
export const ROUTER_MAGIC = 0xFE;
export const CODEC_SEGMENT = "__codecs__";
export const KEEPALIVE_SEGMENT = "__keepalive__";

export enum Mode {
    STANDALONE = 'standalone',
    ROUTER = 'router',
}

export const ErrConnClosed = new Error("connection closed");
export const ErrTimeout = new Error("request timed out");
export const ErrShortFrame = new Error("incomplete frame");
export const ErrMissingMagic = new Error("missing magic byte");

export type Header = {
    clrID: number;
    status: string; // "SUCCESS" or "ERROR"
    fieldCnt: number; // number of fields that follow
};

export type Field = {
    id: number;
    fieldType: number;
    data: Buffer;
};

export type RawResult = {
    status: string;
    fields: Field[];
};