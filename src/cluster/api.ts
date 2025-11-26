// src/cluster/client.ts
import { Handler } from '../internal/cluster/handler';
import type { ClusterConfig } from './config';
import type { CacheClientAPI } from '../api/client';
import type { Codecs } from '../types/codecs';
import type { RawResult } from '../internal/protocol/types';

import {
    buildGetCodecsPayload,
    parseGetCodecsResp,
    buildSetPropPayload,
    parseSetPropResp,
    buildSearchPropPayload,
    parseSearchPropResp,
    buildSearchAvailPayload,
    parseSearchAvailResp,
    buildSetRoomPkgPayload,
    parseSetRoomPkgResp,
    buildSetRoomAvlPayload,
    parseSetRoomAvlResp,
    buildIncRoomAvlPayload,
    parseIncRoomAvlResp,
    buildDecRoomAvlPayload,
    parseDecRoomAvlResp,
    buildPropExistPayload,
    parsePropExistResp,
    buildPropRoomExistPayload,
    parsePropRoomExistResp,
    buildPropRoomListPayload,
    parsePropRoomListResp,
    buildPropRoomDateListPayload,
    parsePropRoomDateListResp,
    buildDelPropPayload,
    parseDelPropResp,
    buildDelSegmentPayload,
    parseDelSegmentResp,
    buildDelPropDayPayload,
    parseDelPropDayResp,
    buildDelPropRoomPayload,
    parseDelPropRoomResp,
    buildDelRoomDayPayload,
    parseDelRoomDayResp,
    buildGetPropRoomDayPayload,
    parseGetPropRoomDayResp,
    buildGetSegmentsPayload,
    parseGetSegmentsResp,
} from '../internal/command/index';

export class Client implements CacheClientAPI {
    private handler: Handler;
    private codecs: Codecs | null = null;

    private constructor(handler: Handler) {
        this.handler = handler;

        // Invalidate codecs on any reconnect (leader or follower change)
        handler.setOnReconnectCallback?.(() => {
            this.codecs = null;
        });
    }

    static async create(cfg: ClusterConfig): Promise<Client> {
        if (!cfg) throw new Error('cfg must not be null');


        const handler = new Handler({
            SeedHosts: cfg.seedHosts,
            APIPort: cfg.apiPort,
            TCPPort: cfg.tcpPort,
            AuthToken: cfg.authToken || '',
            Timeout: cfg.timeout || 5000,
            HttpTimeout: cfg.httpTimeout || 3000,
            KeepAlive: cfg.keepAlive || 30000,
            MaxActiveConns: cfg.maxActiveConns || 100,
            NodeProbeInterval: 2000, // 2 seconds
        });

        const client = new Client(handler);

        client.codecs = await client.fetchCodecs();

        return client;
    }

    private getCodecsSync(): Codecs {
        if (!this.codecs) {
            throw new Error('codecs not initialized — this should not happen in cluster mode');
        }
        return this.codecs;
    }

    private async fetchCodecs(): Promise<Codecs> {
        const payload = buildGetCodecsPayload();
        const resp = await this.handler.execute(false, payload);
        if (resp.status === 'ERROR' && resp.fields.length > 0) {
            throw new Error(resp.fields[0].data.toString('utf8'));
        }
        const codecs = parseGetCodecsResp(resp.status, resp.fields);
        if (!codecs) throw new Error('failed to parse codecs from server');
        return codecs;
    }

    private throwIfServerError(resp: RawResult, context: string): void {
        if (resp.status === 'ERROR' && resp.fields.length > 0) {
            throw new Error(`${context}: ${resp.fields[0].data.toString('utf8')}`);
        }
    }

    // ———————————————————————— PUBLIC API ————————————————————————

    async getCodecs(): Promise<Codecs> {
        if (this.codecs) return this.codecs;
        this.codecs = await this.fetchCodecs();
        return this.codecs;
    }

    async setProp(p: any): Promise<void> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SetProp payload: ${errMsg}`);

        const payload = buildSetPropPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'setProp');
        const err = parseSetPropResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async setRoomPkg(p: any): Promise<void> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SetRoomPkg payload: ${errMsg}`);

        const payload = buildSetRoomPkgPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'setRoomPkg');
        const err = parseSetRoomPkgResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async setRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid SetRoomAvl payload: ${errMsg}`);

        const payload = buildSetRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'setRoomAvl');
        return parseSetRoomAvlResp(resp.status, resp.fields);
    }

    async incRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid IncRoomAvl payload: ${errMsg}`);

        const payload = buildIncRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'incRoomAvl');
        return parseIncRoomAvlResp(resp.status, resp.fields);
    }

    async decRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DecRoomAvl payload: ${errMsg}`);

        const payload = buildDecRoomAvlPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'decRoomAvl');
        return parseDecRoomAvlResp(resp.status, resp.fields);
    }

    async searchProp(p: any): Promise<string[]> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SearchProp payload: ${errMsg}`);

        const payload = buildSearchPropPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'searchProp');
        return parseSearchPropResp(resp.status, resp.fields);
    }

    async searchAvail(p: any): Promise<any[]> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SearchAvail payload: ${errMsg}`);

        const payload = buildSearchAvailPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'searchAvail');
        return parseSearchAvailResp(codecs, resp.status, resp.fields);
    }

    async propExist(propertyID: string): Promise<boolean> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildPropExistPayload(propertyID.trim());
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'propExist');
        return parsePropExistResp(resp.status, resp.fields);
    }

    async propRoomExist(p: any): Promise<boolean> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid PropRoomExist payload: ${errMsg}`);
        const payload = buildPropRoomExistPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'propRoomExist');
        return parsePropRoomExistResp(resp.status, resp.fields);
    }

    async propRoomList(propertyID: string): Promise<string[]> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildPropRoomListPayload(propertyID.trim());
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'propRoomList');
        return parsePropRoomListResp(resp.status, resp.fields);
    }

    async propRoomDateList(p: any): Promise<string[]> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid PropRoomDateList payload: ${errMsg}`);
        const payload = buildPropRoomDateListPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'propRoomDateList');
        return parsePropRoomDateListResp(resp.status, resp.fields);
    }

    async delProp(propertyID: string): Promise<void> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildDelPropPayload(propertyID.trim());
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'delProp');
        const err = parseDelPropResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async delSegment(segment: string): Promise<void> {
        if (!segment?.trim()) throw new Error('segment is required');
        const payload = buildDelSegmentPayload(segment.trim());
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'delSegment');
        const err = parseDelSegmentResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async delPropDay(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelPropDay payload: ${errMsg}`);
        const payload = buildDelPropDayPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'delPropDay');
        const err = parseDelPropDayResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async delPropRoom(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelPropRoom payload: ${errMsg}`);
        const payload = buildDelPropRoomPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'delPropRoom');
        const err = parseDelPropRoomResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async delRoomDay(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelRoomDay payload: ${errMsg}`);
        const payload = buildDelRoomDayPayload(p);
        const resp = await this.handler.execute(true, payload);
        this.throwIfServerError(resp, 'delRoomDay');
        const err = parseDelRoomDayResp(resp.status, resp.fields);
        if (err != null) throw err;
    }

    async getPropRoomDay(p: any): Promise<any> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid GetPropRoomDay payload: ${errMsg}`);
        const payload = buildGetPropRoomDayPayload(p);
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'getPropRoomDay');
        return parseGetPropRoomDayResp(this.getCodecsSync(), resp.status, resp.fields);
    }

    async getSegments(): Promise<any[]> {
        const payload = buildGetSegmentsPayload();
        const resp = await this.handler.execute(false, payload);
        this.throwIfServerError(resp, 'getSegments');
        return parseGetSegmentsResp(resp.status, resp.fields);
    }

    async close(): Promise<void> {
        await this.handler.close();
    }
}