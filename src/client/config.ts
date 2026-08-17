// src/client/RoomzinConfig.ts
import { Mode } from '../internal/protocol/types';

export interface RoomzinConfig {
    addr: string;
    port: number;
    mode: Mode;
    timeout: number;    // ms
    keepAlive: number;  // ms
}

export class RoomzinConfigBuilder {
    private config: RoomzinConfig = {
        addr: '127.0.0.1',
        port: 7777,
        mode: Mode.STANDALONE,
        timeout: 2000,
        keepAlive: 30000,
    };

    withAddr(addr: string): this {
        this.config.addr = addr;
        return this;
    }

    withPort(port: number): this {
        this.config.port = port;
        return this;
    }

    withMode(mode: Mode): this {
        this.config.mode = mode;
        return this;
    }

    withTimeout(timeout: number): this {
        this.config.timeout = timeout;
        return this;
    }

    withKeepAlive(keepAlive: number): this {
        this.config.keepAlive = keepAlive;
        return this;
    }

    build(): RoomzinConfig {
        if (!this.config.addr) {
            throw new Error('addr is required');
        }
        if (this.config.port <= 0) {
            throw new Error('port must be positive');
        }
        return this.config;
    }
}

export function createRoomzinConfig(): RoomzinConfigBuilder {
    return new RoomzinConfigBuilder();
}