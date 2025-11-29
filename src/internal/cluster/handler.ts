import net from 'net';
import { EventEmitter } from 'events';
import { RawResult, Field } from '../protocol/types';
import { parseFields, prependHeader } from '../protocol/frame';
import { buildLoginPayload } from '../protocol/login';
import { ClusterError, getClusterInfo } from './httputil';
import { readFull } from '../protocol/frame';

const MAGIC = 0xFF;
const HEADER_SIZE = 9;
const MAX_BUFFER = 2 * 1024 * 1024;
const QUEUE_CAPACITY = 1024;

interface Pending {
    resolve: (res: RawResult) => void;
    reject: (err: Error) => void;
    sentAt: number;
    timer: NodeJS.Timeout;
    resolved?: boolean;
}

// Go-like channel using EventEmitter — zero race, clean types
class Channel<T> extends EventEmitter {
    private buffer: T[] = [];
    private resolvers: ((value: T) => void)[] = [];
    private closed = false;

    constructor(private capacity = Infinity) {
        super();
    }

    // In Channel<T>
    async send(value: T): Promise<void> {   // ← async + Promise<void>
        if (this.closed) throw new Error('channel closed');

        if (this.resolvers.length > 0) {
            this.resolvers.shift()!(value);
            return;
        }

        if (this.buffer.length < this.capacity) {
            this.buffer.push(value);
            return;
        }

        // Back-pressure: wait for a receiver
        await new Promise<void>(resolve => this.resolvers.push(resolve as any));
        this.buffer.push(value);
    }

    async receive(): Promise<T> {
        if (this.buffer.length > 0) return this.buffer.shift()!;
        if (this.closed) throw new Error('channel closed');
        return new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        });
    }

    close() {
        this.closed = true;
        this.resolvers.forEach(r => r(undefined as any));
        this.resolvers = [];
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: () => this.receive().then(value => ({ value, done: false })),
        };
    }
}

class DemuxMap {
    private map = new Map<number, Pending>();
    private timer: NodeJS.Timeout;
    private maxAgeMs: number;

    constructor(maxAgeMs: number) {
        this.maxAgeMs = maxAgeMs;
        this.timer = setInterval(() => this.cleanup(), maxAgeMs / 2).unref();
    }

    store(id: number, p: Pending) {
        this.map.set(id, p);
    }

    loadRemove(id: number): [Pending | undefined, boolean] {
        const p = this.map.get(id);
        if (p) {
            this.map.delete(id);
        }
        return [p, !!p];
    }

    private cleanup() {
        const threshold = Date.now() - this.maxAgeMs;
        for (const [id, p] of this.map) {
            if (!p.resolved && p.sentAt < threshold) {
                clearTimeout(p.timer);
                p.reject(new Error('request timeout'));
                p.resolved = true;
                this.map.delete(id);
            }
        }
    }

    destroy() {
        clearInterval(this.timer);
        for (const p of this.map.values()) {
            if (!p.resolved) {
                clearTimeout(p.timer);
                p.reject(new Error('handler closed'));
                p.resolved = true;
            }
        }
        this.map.clear();
    }
}

class RollingAverage {
    private samples: number[] = [];
    private idx = 0;
    private sum = 0;
    private count = 0;

    constructor(private size: number) {
        this.samples = new Array(size).fill(0);
    }

    add(v: number) {
        if (this.count < this.size) this.count++;
        else this.sum -= this.samples[this.idx];
        this.samples[this.idx] = v;
        this.sum += v;
        this.idx = (this.idx + 1) % this.size;
    }

    get() {
        return this.count === 0 ? 0 : this.sum / this.count;
    }
}

interface Request {
    payload: Buffer;
    resolve: (r: RawResult) => void;
    reject: (e: Error) => void;
    isWrite: boolean;
}

class Connection extends EventEmitter {
    public latency = 0;
    public avgLatency = new RollingAverage(100);
    public closed = false;

    private socket: net.Socket;
    private pendingHeader: Buffer | null = null;

    private readonly owner?: Handler;        // only set for followers
    private readonly myAddress?: string;     // only set for followers

    constructor(
        socket: net.Socket,
        private demux: DemuxMap,
        cfg: HandlerConfig,
        owner?: Handler,         // ← new optional param
        address?: string         // ← new optional param (e.g. "172.20.0.11:7777")
    ) {
        super();
        this.socket = socket;
        this.owner = owner;
        this.myAddress = address;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, cfg.KeepAlive);

        // Use proper async framing
        this.startReading();

        socket.on('close', () => this.close());
        socket.on('error', err => {
            console.error('[cluster] socket error:', err.message);
            this.close();
        });
    }

    private async startReading() {
        try {
            for await (const _ of this.readFrames()) {
                // no-op — frames handled inside
            }
        } catch (err) {
            console.error('[cluster] frame read error:', err);
            this.close();
        }
    }

    private async * readFrames(): AsyncGenerator<void> {
        while (!this.closed) {
            // Phase 1: Read header (9 bytes)
            if (!this.pendingHeader) {
                this.pendingHeader = Buffer.alloc(9);
                await readFull(this.socket, this.pendingHeader);
            }

            if (this.pendingHeader[0] !== 0xFF) {
                throw new Error(`bad magic: 0x${this.pendingHeader[0].toString(16)}`);
            }

            const clrID = this.pendingHeader.readUInt32LE(1);
            const payloadLen = this.pendingHeader.readUInt32LE(5);

            // Phase 2: Read exact payload
            const payload = Buffer.alloc(payloadLen);
            await readFull(this.socket, payload);

            // Reset for next frame
            this.pendingHeader = null;

            // Now safe to parse
            this.handleFrame(clrID, payload);
            yield;
        }
    }

    private handleFrame(clrID: number, payload: Buffer) {
        if (payload.length < 1) {
            this.close();
            return;
        }

        const statusLen = payload[0];
        if (payload.length < 1 + statusLen + 2) {
            this.close();
            return;
        }

        const status = payload.toString('utf8', 1, 1 + statusLen);
        const fieldCnt = payload.readUInt16LE(1 + statusLen);
        const fieldsData = payload.subarray(1 + statusLen + 2);

        let fields: Field[] = [];
        try {
            fields = parseFields(fieldsData, fieldCnt);
        } catch (err) {
            console.error('[cluster] field parse error:', err);
            this.close();
            return;
        }

        const [pending, found] = this.demux.loadRemove(clrID);
        // console.log('[handle frame] clrID=', clrID, 'found=', found, 'status=', status);

        if (!found || !pending || pending.resolved) return;

        clearTimeout(pending.timer);
        pending.resolved = true;

        const latency = Date.now() - pending.sentAt;
        this.latency = latency;
        this.avgLatency.add(latency);

        if (status === 'ERROR' && fields.length > 0) {
            const code = fields[0].data.toString();
            if (['308', '405', '503'].includes(code)) this.close();
            if (code === '429') this.avgLatency.add(50);
        }

        pending.resolve({ status, fields });
    }

    write(frame: Buffer) {
        if (this.closed) return;
        this.socket.write(frame, err => {
            if (err) {
                console.error('[cluster] write error:', err.message);
                this.close();
            }
        });
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.socket.destroy();
        this.pendingHeader = null;

        if (this.owner && this.myAddress) {
            // We are a follower → tell owner to remove us from the map
            this.owner['removeFollower'](this.myAddress);
        }

        this.emit('close');
    }
}

export interface HandlerConfig {
    SeedHosts: string;
    APIPort: number;
    TCPPort: number;
    AuthToken: string;
    Timeout: number;
    HttpTimeout: number;
    KeepAlive: number;
    MaxActiveConns: number;
    NodeProbeInterval: number;
}

export class Handler {
    private cfg: HandlerConfig;
    private leaderDemux: DemuxMap;
    private followerDemux: DemuxMap;
    private leaderConn?: Connection;
    private followerConns = new Map<string, Connection>();
    private leaderClrID = 0;
    private followerClrID = 0;
    private reqChan = new Channel<Request>(QUEUE_CAPACITY);
    private closed = false;
    private onReconnect?: () => void;

    private followerProbeTimer?: NodeJS.Timeout;
    private followerFastCheckTimer?: NodeJS.Timeout;

    constructor(cfg: HandlerConfig) {
        this.cfg = cfg;
        this.leaderDemux = new DemuxMap(cfg.Timeout * 2);
        this.followerDemux = new DemuxMap(cfg.Timeout * 2);

        // Starts draining IMMEDIATELY — no race
        this.drainRequests();

        this.startLeaderWorker();
        this.startFollowerWorker();
    }

    setOnReconnectCallback(cb: () => void) {
        this.onReconnect = cb;
    }

    private removeFollower(addr: string) {
        this.followerConns.delete(addr);
    }

    private async connect(host: string): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({
                host,
                port: this.cfg.TCPPort,
                keepAlive: true,
                keepAliveInitialDelay: this.cfg.KeepAlive,
            });

            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('connect timeout'));
            }, this.cfg.Timeout);

            const cleanup = () => {
                clearTimeout(timer);
                socket.removeAllListeners();
            };

            socket.once('connect', () => {
                socket.write(prependHeader(0, buildLoginPayload(this.cfg.AuthToken)));
            });

            socket.once('data', data => {
                if (data.toString().includes('LOGIN OK')) {
                    cleanup();
                    resolve(socket);
                }
            });

            socket.once('error', err => {
                cleanup();
                reject(err);
            });
        });
    }

    private async reconnectLeader() {
        try {
            const { leader } = await getClusterInfo(this.cfg);
            const socket = await this.connect(leader);
            const conn = new Connection(socket, this.leaderDemux, this.cfg);
            this.leaderConn?.close();
            this.leaderConn = conn;
            this.onReconnect?.();
        } catch { }
    }

    private async syncFollowers() {
        try {
            const { followers } = await getClusterInfo(this.cfg);
            const wanted = new Set(followers);

            for (const [addr, conn] of this.followerConns) {
                if (!wanted.has(addr)) {
                    conn.close();
                    this.followerConns.delete(addr);
                }
            }

            for (const addr of wanted) {
                if (this.followerConns.has(addr)) continue;
                try {
                    const socket = await this.connect(addr);
                    const conn = new Connection(socket, this.followerDemux, this.cfg, this, addr);
                    this.followerConns.set(addr, conn);
                } catch { }
            }
        } catch { }
    }

    private startLeaderWorker() {
        (async () => {
            let backoff = 100;
            while (!this.closed) {
                if (!this.leaderConn || this.leaderConn.closed) {
                    await this.reconnectLeader();
                }
                await new Promise(r => setTimeout(r, backoff + Math.random() * 50));
                backoff = Math.min(backoff * 2, 2000);
            }
        })().catch(() => { });
    }

    private startFollowerWorker() {
        this.followerProbeTimer = setInterval(() => {
            this.syncFollowers().catch(() => { });
        }, this.cfg.NodeProbeInterval).unref();

        this.followerFastCheckTimer = setInterval(() => {
            const allClosed = [...this.followerConns.values()].every(c => c.closed);
            if (allClosed && this.followerConns.size > 0) {
                this.syncFollowers().catch(() => { });
            }
        }, 100).unref();
    }

    private async drainRequests() {
        try {
            for await (const req of this.reqChan) {
                // req is never undefined — fixed iterator
                if (this.closed) break;

                const deadline = Date.now() + this.cfg.Timeout * 3;
                let backoff = 10;
                let conn: Connection | undefined;

                while (Date.now() < deadline) {
                    conn = req.isWrite ? this.leaderConn : this.bestFollower();
                    if (conn && !conn.closed) break;
                    await new Promise(r => setTimeout(r, backoff));
                    backoff = Math.min(backoff * 2, 1000);
                    if (!req.isWrite) await this.syncFollowers();
                }

                if (!conn || conn.closed) {
                    req.reject(new ClusterError('no healthy node'));
                    continue;
                }

                const clrID = req.isWrite
                    ? (this.leaderClrID = (this.leaderClrID + 1) >>> 0)
                    : (this.followerClrID = (this.followerClrID + 1) >>> 0);

                const frame = prependHeader(clrID, req.payload);
                const demux = req.isWrite ? this.leaderDemux : this.followerDemux;

                const pending: Pending = {
                    resolve: req.resolve,
                    reject: req.reject,
                    sentAt: Date.now(),
                    timer: setTimeout(() => {
                        const [p] = demux.loadRemove(clrID);
                        if (p && !p.resolved) {
                            p.reject(new Error('request timeout'));
                            p.resolved = true;
                        }
                    }, this.cfg.Timeout * 2).unref(),
                };

                demux.store(clrID, pending);
                conn.write(frame);
                pending.sentAt = Date.now();
            }
        } catch (err) {
            console.error('FATAL: request drain loop died:', err);
            process.exit(1);
        }
    }

    private bestFollower(): Connection | undefined {
        const alive = [...this.followerConns.values()].filter(c => !c.closed);
        if (alive.length === 0) return undefined;
        const scored = alive.filter(c => c.avgLatency.get() > 0);
        if (scored.length > 0) {
            scored.sort((a, b) => a.avgLatency.get() - b.avgLatency.get());
            return scored[0];
        }
        return alive[0];
    }

    async execute(isWrite: boolean, payload: Buffer): Promise<RawResult> {
        if (payload.length === 0) throw new Error('empty payload');

        if (isWrite && !this.leaderConn) {
            throw new ClusterError("cluster has no leader");
        }

        const result = await new Promise<RawResult>((resolve, reject) => {
            this.reqChan.send({ payload, resolve, reject, isWrite })
                .catch(reject);
        });

        if (result.status === 'SUCCESS') return result;

        const code = result.fields[0]?.data.toString() || result.status;
        const maxRetries = 5;
        let attempts = 1;

        while (attempts++ < maxRetries) {
            if (code === '503' || code === '429') {
                await new Promise(r => setTimeout(r, attempts * 100));
            }
            const retryResult = await new Promise<RawResult>((resolve, reject) => {
                try {
                    this.reqChan.send({ payload, resolve, reject, isWrite });
                } catch (err) {
                    reject(err);
                }
            });
            if (retryResult.status === 'SUCCESS') return retryResult;
        }

        throw new ClusterError(`max retries exceeded: ${code}`);
    }

    async close(): Promise<void> {
        this.closed = true;
        this.reqChan.close();

        // These will now safely do nothing if undefined
        if (this.followerProbeTimer !== undefined) {
            clearInterval(this.followerProbeTimer);
            this.followerProbeTimer = undefined;
        }
        if (this.followerFastCheckTimer !== undefined) {
            clearInterval(this.followerFastCheckTimer);
            this.followerFastCheckTimer = undefined;
        }

        this.leaderDemux.destroy();
        this.followerDemux.destroy();
        this.leaderConn?.close();
        for (const c of this.followerConns.values()) c.close();
        this.followerConns.clear();
    }
}