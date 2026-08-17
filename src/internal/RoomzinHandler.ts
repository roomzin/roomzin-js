import net from 'net';
import { Mutex } from 'async-mutex';
import { RoomzinConfig } from '../client/RoomzinConfig';
import { Mode, RawResult, ErrConnClosed, ErrTimeout, CODEC_SEGMENT } from './protocol/types';
import { prependHeader, prependRouterHeader, buildKeepaliveFrame, drainFrame, parseFields } from './protocol/frame';
import { RzError } from './err';

export class RoomzinHandler {
    private config: RoomzinConfig;
    private conn: net.Socket | null = null;
    private nextId = 0;
    private mu = new Mutex();
    private closed = false;
    private demux = new Map<number, { resolve: (r: RawResult) => void; timer?: NodeJS.Timeout }>();
    private onReconnect?: () => void;
    private keepaliveInterval?: NodeJS.Timeout;

    constructor(config: RoomzinConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        await this.reconnect();
        if (this.config.mode === Mode.ROUTER) {
            this.startKeepalive();
        }
    }

    private async reconnect(): Promise<void> {
        const release = await this.mu.acquire();
        try {
            if (this.conn) {
                this.conn.destroy();
                this.conn = null;
            }

            const addr = `${this.config.addr}:${this.config.port}`;

            this.conn = await this.dial(addr);
            this.startReadLoop();
        } finally {
            release();
        }
    }

    private dial(addr: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('dial timeout'));
            }, this.config.timeout);

            socket.connect(this.config.port, this.config.addr, () => {
                clearTimeout(timeout);
                socket.setKeepAlive(true, this.config.keepAlive);
                resolve(socket);
            });

            socket.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    private startKeepalive(): void {
        if (this.keepaliveInterval) return;
        this.keepaliveInterval = setInterval(() => {
            if (this.closed || !this.conn || this.conn.destroyed) return;
            try {
                const frame = buildKeepaliveFrame(0);
                this.conn.write(frame);
            } catch (_e) {
                // Ignore write errors, reconnect will handle
            }
        }, this.config.keepAlive);
    }

    private stopKeepalive(): void {
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = undefined;
        }
    }

    async close(): Promise<void> {
        const release = await this.mu.acquire();
        try {
            if (this.closed) return;
            this.closed = true;
            this.stopKeepalive();
            if (this.conn) this.conn.destroy();
            for (const entry of this.demux.values()) {
                clearTimeout(entry.timer);
                entry.resolve({ status: '', fields: [] });
            }
            this.demux.clear();
        } finally {
            release();
        }
    }

    nextID(): number {
        return ++this.nextId;
    }

    async execute(segment: string, isWrite: boolean, payload: Buffer): Promise<RawResult> {
        const release = await this.mu.acquire();
        try {
            if (this.closed) throw RzError(ErrConnClosed);

            if (!this.conn || this.conn.destroyed) {
                release();
                await this.reconnect();
                return this.execute(segment, isWrite, payload);
            }

            const clrId = this.nextID();

            const promise = new Promise<RawResult>((resolve) => {
                const timer = setTimeout(() => {
                    this.demux.delete(clrId);
                    this.reconnect().catch(() => { });
                    resolve({ status: 'ERROR', fields: [] });
                }, this.config.timeout);

                this.demux.set(clrId, { resolve, timer });
            });

            let frame: Buffer;
            if (this.config.mode === Mode.ROUTER) {
                frame = prependRouterHeader(segment, isWrite, clrId, payload);
            } else {
                frame = prependHeader(clrId, payload);
            }

            this.conn.write(frame, (err) => {
                if (err) {
                    this.demux.delete(clrId);
                    this.reconnect().catch(() => { });
                }
            });

            release();
            return await promise;
        } catch (err) {
            release();
            throw RzError(err instanceof Error ? err : String(err));
        }
    }

    private startReadLoop(): void {
        if (!this.conn) return;

        const loop = async () => {
            try {
                while (this.conn && !this.conn.destroyed && !this.closed) {
                    const [header, payload] = await drainFrame(this.conn);
                    const fieldStart = 1 + header.status.length + 2;
                    const fields = parseFields(payload.subarray(fieldStart), header.fieldCnt);

                    const entry = this.demux.get(header.clrID);
                    if (entry) {
                        clearTimeout(entry.timer);
                        entry.resolve({ status: header.status, fields });
                        this.demux.delete(header.clrID);
                    }
                }
            } catch (err) {
                this.failAll(err instanceof Error ? err : new Error('read error'));
                if (this.onReconnect) this.onReconnect();
            }
        };

        loop();
    }

    private failAll(err: Error): void {
        for (const [id, entry] of this.demux) {
            clearTimeout(entry.timer);
            entry.resolve({ status: 'ERROR', fields: [] });
            this.demux.delete(id);
        }
        if (this.onReconnect) this.onReconnect();
    }

    setOnReconnect(callback: () => void): void {
        this.onReconnect = callback;
    }
}