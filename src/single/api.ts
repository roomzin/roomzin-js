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

import { DelPropDayRequest, DelPropRoomPayload, DelRoomDayRequest, GetRoomDayRequest, PropRoomDateListPayload, PropRoomExistPayload, SearchAvailPayload, SearchPropPayload, SetPropPayload, SetRoomPkgPayload, UpdRoomAvlPayload, verifyDelPropDayRequest, verifyDelRoomDayRequest, verifyGetRoomDayRequest, verifySearchAvailPayload, verifySearchPropPayload, verifySetPropPayload, verifySetRoomPkgPayload, verifyUpdRoomAvlPayload } from '../types/request';

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
    private async getCodecsInternal(): Promise<Codecs> {
        if (this.codecs != null) {
            return this.codecs;
        }
        this.codecs = await this.fetchCodecs();
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

    async setProp(p: SetPropPayload): Promise<void> {
        const codecs = this.getCodecsInternal();
        const [valid, errMsg] = verifySetPropPayload(p, codecs);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildSetPropPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setProp');
    }

    async searchProp(p: SearchPropPayload): Promise<string[]> {
        const codecs = this.getCodecsInternal();
        const [valid, errMsg] = verifySearchPropPayload(p, codecs);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildSearchPropPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'searchProp');
        return parseSearchPropResp(res.status, res.fields);
    }

    async searchAvail(p: SearchAvailPayload): Promise<any[]> {
        const codecs = await this.getCodecsInternal();
        const [valid, errMsg] = verifySearchAvailPayload(p, codecs);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildSearchAvailPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'searchAvail');
        return parseSearchAvailResp(codecs, res.status, res.fields);
    }

    async setRoomPkg(p: SetRoomPkgPayload): Promise<void> {
        const codecs = this.getCodecsInternal();
        const [valid, errMsg] = verifySetRoomPkgPayload(p, codecs);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildSetRoomPkgPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setRoomPkg');
    }

    async setRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildSetRoomAvlPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'setRoomAvl');
        return parseSetRoomAvlResp(res.status, res.fields);
    }

    async incRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildIncRoomAvlPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'incRoomAvl');
        return parseIncRoomAvlResp(res.status, res.fields);
    }

    async decRoomAvl(p: UpdRoomAvlPayload): Promise<number> {
        const [valid, errMsg] = verifyUpdRoomAvlPayload(p);
        if (!valid) throw new Error(`${errMsg}`);

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

    async propRoomExist(p: PropRoomExistPayload): Promise<boolean> {
        if (!p.propertyID?.trim()) throw new Error('propertyID is required');
        if (!p.roomType?.trim()) throw new Error('roomType is required');

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

    async propRoomDateList(p: PropRoomDateListPayload): Promise<string[]> {
        if (!p.propertyID?.trim()) throw new Error('propertyID is required');
        if (!p.roomType?.trim()) throw new Error('roomType is required');

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

    async delPropDay(p: DelPropDayRequest): Promise<void> {
        const [valid, errMsg] = verifyDelPropDayRequest(p);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildDelPropDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delPropDay');
    }

    async delPropRoom(p: DelPropRoomPayload): Promise<void> {
        if (!p.propertyID?.trim()) throw new Error('propertyID is required');
        if (!p.roomType?.trim()) throw new Error('roomType is required');

        const payload = buildDelPropRoomPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delPropRoom');
    }

    async delRoomDay(p: DelRoomDayRequest): Promise<void> {
        const [valid, errMsg] = verifyDelRoomDayRequest(p);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildDelRoomDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'delRoomDay');
    }

    async getPropRoomDay(p: GetRoomDayRequest): Promise<any> {
        const [valid, errMsg] = verifyGetRoomDayRequest(p);
        if (!valid) throw new Error(`${errMsg}`);

        const payload = buildGetPropRoomDayPayload(p);
        const res = await this.roundTrip(payload);
        this.assertOk(res.status, res.fields, 'getPropRoomDay');
        const codecs = await this.getCodecsInternal();
        return parseGetPropRoomDayResp(codecs, res.status, res.fields);
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