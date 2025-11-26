// src/single/client.ts
import { SingleHandler } from '../internal/single/handler';
import type { Config } from './config';
import type { CacheClientAPI } from '../api/client';
import type { Codecs } from '../types/codecs';
import type { RawResult, Field } from '../internal/protocol/types';

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
    private handler: SingleHandler;
    private codecs: Codecs | null = null;
    private closed = false;
    private nextClrId = 1;

    private constructor(handler: SingleHandler) {
        this.handler = handler;
    }

    static async create(cfg: Config): Promise<Client> {
        if (!cfg) throw new Error('cfg must not be null');

        const handler = new SingleHandler({
            addr: cfg.host,
            tcpPort: cfg.tcpPort,
            authToken: cfg.authToken,
            timeout: cfg.timeout,
            keepAlive: cfg.keepAlive,
        });

        await handler.connect();

        const client = new Client(handler);
        handler.setOnReconnect(() => {
            client.codecs = null; // invalidate on reconnect
        });

        client.codecs = await client.fetchCodecs();
        return client;
    }

    private nextID(): number {
        return this.nextClrId++;
    }

    private async roundTrip(payload: Buffer): Promise<RawResult> {
        if (this.closed) throw new Error('client is closed');
        const clrId = this.nextID();
        return await this.handler.roundTrip(clrId, payload);
    }

    private async fetchCodecs(): Promise<Codecs> {
        const payload = buildGetCodecsPayload();
        const res = await this.roundTrip(payload);
        const codecs = parseGetCodecsResp(res.status, res.fields);
        if (!codecs) throw new Error('failed to get codecs list from server');
        return codecs;
    }

    // Returns cached codecs synchronously (safe because we pre-fetch on create)
    private getCodecsSync(): Codecs {
        if (!this.codecs) {
            throw new Error('codecs not loaded yet — this should not happen');
        }
        return this.codecs;
    }

    // Public async version
    async getCodecs(): Promise<Codecs> {
        if (this.codecs) return this.codecs;
        this.codecs = await this.fetchCodecs();
        return this.codecs;
    }

    // Helper: throw on server ERROR status
    private assertOk(status: string, fields: Field[], context: string): void {
        if (status === 'ERROR') {
            const msg = fields.length > 0 ? fields[0].data.toString('utf8') : 'unknown error';
            throw new Error(`${context}: ${msg}`);
        }
        if (status !== 'SUCCESS') {
            throw new Error(`${context}: unexpected status "${status}"`);
        }
    }

    // ———————————————————————— API ————————————————————————

    async setProp(p: any): Promise<void> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SetProp payload: ${errMsg}`);

        const payload = buildSetPropPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setProp');
    }

    async searchProp(p: any): Promise<string[]> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SearchProp payload: ${errMsg}`);

        const payload = buildSearchPropPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'searchProp');
        return parseSearchPropResp(res.status, res.fields);
    }

    async searchAvail(p: any): Promise<any[]> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SearchAvail payload: ${errMsg}`);

        const payload = buildSearchAvailPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'searchAvail');
        return parseSearchAvailResp(codecs, res.status, res.fields);
    }

    async setRoomPkg(p: any): Promise<void> {
        const codecs = this.getCodecsSync();
        const errMsg = p.verify?.(codecs);
        if (errMsg) throw new Error(`invalid SetRoomPkg payload: ${errMsg}`);

        const payload = buildSetRoomPkgPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setRoomPkg');
    }

    async setRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid SetRoomAvl payload: ${errMsg}`);

        const payload = buildSetRoomAvlPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setRoomAvl');
        return parseSetRoomAvlResp(res.status, res.fields);
    }

    async incRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid IncRoomAvl payload: ${errMsg}`);

        const payload = buildIncRoomAvlPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'incRoomAvl');
        return parseIncRoomAvlResp(res.status, res.fields);
    }

    async decRoomAvl(p: any): Promise<number> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DecRoomAvl payload: ${errMsg}`);

        const payload = buildDecRoomAvlPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'decRoomAvl');
        return parseDecRoomAvlResp(res.status, res.fields);
    }

    async propExist(propertyID: string): Promise<boolean> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildPropExistPayload(propertyID.trim());
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'propExist');
        return parsePropExistResp(res.status, res.fields);
    }

    async propRoomExist(p: any): Promise<boolean> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid PropRoomExist payload: ${errMsg}`);
        const payload = buildPropRoomExistPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'propRoomExist');
        return parsePropRoomExistResp(res.status, res.fields);
    }

    async propRoomList(propertyID: string): Promise<string[]> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildPropRoomListPayload(propertyID.trim());
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'propRoomList');
        return parsePropRoomListResp(res.status, res.fields);
    }

    async propRoomDateList(p: any): Promise<string[]> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid PropRoomDateList payload: ${errMsg}`);
        const payload = buildPropRoomDateListPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'propRoomDateList');
        return parsePropRoomDateListResp(res.status, res.fields);
    }

    async delProp(propertyID: string): Promise<void> {
        if (!propertyID?.trim()) throw new Error('propertyID is required');
        const payload = buildDelPropPayload(propertyID.trim());
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delProp');
    }

    async delSegment(segment: string): Promise<void> {
        if (!segment?.trim()) throw new Error('segment is required');
        const payload = buildDelSegmentPayload(segment.trim());
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delSegment');
    }

    async delPropDay(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelPropDay payload: ${errMsg}`);
        const payload = buildDelPropDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delPropDay');
    }

    async delPropRoom(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelPropRoom payload: ${errMsg}`);
        const payload = buildDelPropRoomPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delPropRoom');
    }

    async delRoomDay(p: any): Promise<void> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid DelRoomDay payload: ${errMsg}`);
        const payload = buildDelRoomDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delRoomDay');
    }

    async getPropRoomDay(p: any): Promise<any> {
        const errMsg = p.verify?.();
        if (errMsg) throw new Error(`invalid GetPropRoomDay payload: ${errMsg}`);
        const payload = buildGetPropRoomDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'getPropRoomDay');
        return parseGetPropRoomDayResp(this.getCodecsSync(), res.status, res.fields);
    }

    async getSegments(): Promise<any[]> {
        const payload = buildGetSegmentsPayload();
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'getSegments');
        return parseGetSegmentsResp(res.status, res.fields);
    }

    async close(): Promise<void> {
        this.closed = true;
        await this.handler.close();
    }
}