// src/client/RoomzinClient.ts
import { RoomzinConfig } from './config';
import { RoomzinHandler } from '../internal/handler';
import { CODEC_SEGMENT, RawResult } from '../internal/protocol/types';
import { RzError } from '../internal/err';
import * as commands from '../internal/command';
import {
    SetPropPayload,
    SearchPropPayload,
    SearchAvailPayload,
    SetRoomPkgPayload,
    UpdRoomAvlPayload,
    DelPropDayRequest,
    DelPropRoomPayload,
    DelRoomDayRequest,
    PropRoomExistPayload,
    PropRoomDateListPayload,
    GetRoomDayRequest,
    GetRoomDayResult,
    PropertyAvail,
    Codecs,
} from '../types';

export class RoomzinClient {
    private handler: RoomzinHandler;
    private codecs: Codecs | null = null;

    constructor(config: RoomzinConfig) {
        this.handler = new RoomzinHandler(config);
        this.handler.setOnReconnect(() => {
            this.codecs = null;
        });
    }

    async connect(): Promise<void> {
        await this.handler.connect();
    }

    async close(): Promise<void> {
        await this.handler.close();
    }

    private async getCodecsInternal(): Promise<Codecs | null> {
        if (this.codecs) {
            return this.codecs;
        }
        try {
            this.codecs = await this.fetchCodecs();
            return this.codecs;
        } catch {
            return null;
        }
    }

    private async fetchCodecs(): Promise<Codecs> {
        const payload = commands.buildGetCodecsPayload();
        const result = await this.handler.execute(CODEC_SEGMENT, false, payload);
        return commands.parseGetCodecsResp(result.status, result.fields);
    }

    async getCodecs(): Promise<Codecs> {
        const codecs = await this.getCodecsInternal();
        if (!codecs) {
            throw RzError('failed to fetch codecs');
        }
        return codecs;
    }

    // -------------------- WRITE COMMANDS --------------------

    async setProp(segment: string, payload: SetPropPayload): Promise<void> {
        const codecs = await this.getCodecsInternal();
        const cmdPayload = commands.buildSetPropPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseSetPropResp(result.status, result.fields);
    }

    async setRoomPkg(segment: string, payload: SetRoomPkgPayload): Promise<void> {
        const codecs = await this.getCodecsInternal();
        const cmdPayload = commands.buildSetRoomPkgPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseSetRoomPkgResp(result.status, result.fields);
    }

    async setRoomAvl(segment: string, payload: UpdRoomAvlPayload): Promise<number> {
        const cmdPayload = commands.buildSetRoomAvlPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        return commands.parseSetRoomAvlResp(result.status, result.fields);
    }

    async incRoomAvl(segment: string, payload: UpdRoomAvlPayload): Promise<number> {
        const cmdPayload = commands.buildIncRoomAvlPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        return commands.parseIncRoomAvlResp(result.status, result.fields);
    }

    async decRoomAvl(segment: string, payload: UpdRoomAvlPayload): Promise<number> {
        const cmdPayload = commands.buildDecRoomAvlPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        return commands.parseDecRoomAvlResp(result.status, result.fields);
    }

    async delProp(segment: string, propertyId: string): Promise<void> {
        const cmdPayload = commands.buildDelPropPayload(propertyId);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseDelPropResp(result.status, result.fields);
    }

    async delSegment(segment: string): Promise<void> {
        const cmdPayload = commands.buildDelSegmentPayload(segment);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseDelSegmentResp(result.status, result.fields);
    }

    async delPropDay(segment: string, payload: DelPropDayRequest): Promise<void> {
        const cmdPayload = commands.buildDelPropDayPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseDelPropDayResp(result.status, result.fields);
    }

    async delPropRoom(segment: string, payload: DelPropRoomPayload): Promise<void> {
        const cmdPayload = commands.buildDelPropRoomPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseDelPropRoomResp(result.status, result.fields);
    }

    async delRoomDay(segment: string, payload: DelRoomDayRequest): Promise<void> {
        const cmdPayload = commands.buildDelRoomDayPayload(payload);
        const result = await this.handler.execute(segment, true, cmdPayload);
        commands.parseDelRoomDayResp(result.status, result.fields);
    }

    // -------------------- READ COMMANDS --------------------

    async searchProp(segment: string, payload: SearchPropPayload): Promise<string[]> {
        const codecs = await this.getCodecsInternal();
        const cmdPayload = commands.buildSearchPropPayload(payload);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parseSearchPropResp(result.status, result.fields);
    }

    async searchAvail(segment: string, payload: SearchAvailPayload): Promise<PropertyAvail[]> {
        const codecs = await this.getCodecsInternal();
        const cmdPayload = commands.buildSearchAvailPayload(payload);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parseSearchAvailResp(codecs, result.status, result.fields);
    }

    async propExist(segment: string, propertyId: string): Promise<boolean> {
        const cmdPayload = commands.buildPropExistPayload(propertyId);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parsePropExistResp(result.status, result.fields);
    }

    async propRoomExist(segment: string, payload: PropRoomExistPayload): Promise<boolean> {
        const cmdPayload = commands.buildPropRoomExistPayload(payload);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parsePropRoomExistResp(result.status, result.fields);
    }

    async propRoomList(segment: string, propertyId: string): Promise<string[]> {
        const cmdPayload = commands.buildPropRoomListPayload(propertyId);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parsePropRoomListResp(result.status, result.fields);
    }

    async propRoomDateList(segment: string, payload: PropRoomDateListPayload): Promise<string[]> {
        const cmdPayload = commands.buildPropRoomDateListPayload(payload);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parsePropRoomDateListResp(result.status, result.fields);
    }

    async getPropRoomDay(segment: string, payload: GetRoomDayRequest): Promise<GetRoomDayResult> {
        const codecs = await this.getCodecsInternal();
        const cmdPayload = commands.buildGetPropRoomDayPayload(payload);
        const result = await this.handler.execute(segment, false, cmdPayload);
        return commands.parseGetPropRoomDayResp(codecs, result.status, result.fields);
    }
}