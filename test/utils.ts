import { RzError } from '../src/internal/err';
import { CacheClientAPI } from './../src/api/client';
// ─────────────────────────────────────────────────────────────────────────────
// Tiny utilities (exact Go equivalents)
// ─────────────────────────────────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function tomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

export function dayOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days + 1);
    return d.toISOString().split('T')[0];
}

function pickCat(i: number): string {
    const cats = ['luxury', 'budget', 'midrange'];
    return cats[i % cats.length];
}

function pickAmenities(i: number): string[] {
    const opts: string[][] = [
        ['wifi'],
        ['wifi', 'pool'],
        ['wifi', 'gym'],
        ['wifi', 'spa'],
        ['wifi', 'parking'],
        ['wifi', 'pool', 'gym'],
    ];
    return opts[i % opts.length];
}

function pickCancel(i: number): string[] {
    const all = [
        'free_cancellation',
        'non_refundable',
        'pay_at_property',
        'includes_breakfast',
        'free_wifi',
        'no_prepayment',
        'partial_refund',
        'instant_confirmation',
    ];
    return all.slice(0, (i % 8) + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full test flow (exact Go logic, zero deviation)
// ─────────────────────────────────────────────────────────────────────────────
export async function seedTestData(c: CacheClientAPI): Promise<void> {
    const segments = ['seg9', 'seg10'];
    const areas = ['arA', 'arB', 'arC'];
    const roomTypes = [
        'single', 'double', 'suite',
        'deluxe', 'studio', 'penthouse',
        'economy', 'family', 'presidential',
    ];
    const dates = [tomorrow(), dayOffset(1), dayOffset(2)];

    for (const seg of segments) {
        for (const area of areas) {
            for (let i = 1; i <= 6; i++) {
                const propID = `${seg}_${area}_p${i}`;
                await c.setProp({
                    segment: seg,
                    area,
                    propertyID: propID,
                    propertyType: 'hotel',
                    category: pickCat(i),
                    stars: (i - 1) % 5 + 1,
                    latitude: 40.7128 + i * 0.001,
                    longitude: -74.0060 + i * 0.001,
                    amenities: pickAmenities(i),
                });

                for (const rt of roomTypes) {
                    for (const d of dates) {
                        const avail = 10 + i;
                        const price = 100 + i * 10;
                        await c.setRoomPkg({
                            propertyID: propID,
                            roomType: rt,
                            date: d,
                            availability: avail,
                            finalPrice: price,
                            rateCancel: pickCancel(i),
                        });
                    }
                }
            }
        }
    }
}

export async function updateAvailTestData(c: CacheClientAPI): Promise<void> {
    const segments = ['seg9', 'seg10'];
    const areas = ['arA', 'arB', 'arC'];
    const roomTypes = [
        'single', 'double', 'suite',
        'deluxe', 'studio', 'penthouse',
        'economy', 'family', 'presidential',
    ];
    const dates = [tomorrow(), dayOffset(1), dayOffset(2)];

    for (const seg of segments) {
        for (const area of areas) {
            for (let i = 1; i <= 6; i++) {
                const propID = `${seg}_${area}_p${i}`;
                for (const rt of roomTypes) {
                    for (const d of dates) {
                        await c.incRoomAvl({ propertyID: propID, roomType: rt, date: d, amount: 1 });
                        await c.decRoomAvl({ propertyID: propID, roomType: rt, date: d, amount: 1 });
                        await c.setRoomAvl({ propertyID: propID, roomType: rt, date: d, amount: 10 + i });
                    }
                }
            }
        }
    }
}

export async function checkSegmentIsolation(c: CacheClientAPI): Promise<void> {
    for (const seg of ['seg9', 'seg10']) {
        const ids = await c.searchProp({ segment: seg });
        for (const id of ids) {
            if (!id.startsWith(seg + '_')) {
                throw RzError(`segment leak: ${id} found in ${seg} search`);
            }
        }
    }
}

export async function checkAmenitiesAndCancel(c: CacheClientAPI): Promise<void> {
    const limit = 300;
    const avail = await c.searchAvail({
        segment: 'seg9',
        roomType: 'single',
        date: [tomorrow()],
        limit,
        amenities: ['pool'],
        rateCancel: ['free_cancellation'],
    });

    if (avail.length === 0) {
        throw RzError('expected at least one result with pool');
    }

    for (const a of avail) {
        for (const record of a.days) {
            try {
                const day = await c.getPropRoomDay({
                    propertyID: a.propertyID,
                    roomType: 'single',
                    date: record.date,
                });
                if (!day.rateCancel.includes('free_cancellation')) {
                    throw RzError(`expected free_cancellation in ${JSON.stringify(day.rateCancel)}`);
                }
            } catch (error) {
                console.error(error);
            }
        }
    }
}

export async function checkPropRoomList(c: CacheClientAPI): Promise<void> {
    const rooms = await c.propRoomList('seg9_arA_p1');
    const want = [
        'single', 'double', 'suite', 'deluxe', 'studio',
        'penthouse', 'economy', 'family', 'presidential',
    ];
    const sortedRooms = [...rooms].sort();
    const sortedWant = [...want].sort();
    if (JSON.stringify(sortedRooms) !== JSON.stringify(sortedWant)) {
        throw RzError(`PropRoomList: got ${sortedRooms}, want ${sortedWant}`);
    }
}

export async function checkDateLists(c: CacheClientAPI): Promise<void> {
    const dates = await c.propRoomDateList({
        propertyID: 'seg9_arB_p1',
        roomType: 'single',
    });
    const want = [tomorrow(), dayOffset(1), dayOffset(2)];
    const sortedDates = [...dates].sort();
    const sortedWant = [...want].sort();
    if (JSON.stringify(sortedDates) !== JSON.stringify(sortedWant)) {
        throw RzError(`date list mismatch: got ${sortedDates} want ${sortedWant}`);
    }
}

export async function checkGeoSearch(c: CacheClientAPI): Promise<void> {
    const lat = 40.7128;
    const lon = -74.0060;
    const props = await c.searchProp({ segment: 'seg9', latitude: lat, longitude: lon });

    const wantMap = new Set<string>();
    for (const area of ['arA', 'arB', 'arC']) {
        for (let i = 1; i <= 6; i++) {
            wantMap.add(`seg9_${area}_p${i}`);
        }
    }

    if (props.length !== wantMap.size) {
        throw RzError(`geo search returned ${props.length} props, want ${wantMap.size}`);
    }

    for (const id of props) {
        if (!wantMap.has(id)) {
            throw RzError(`unexpected prop in geo result: ${id}`);
        }
        const day = await c.getPropRoomDay({
            propertyID: id,
            roomType: 'single',
            date: tomorrow(),
        });
        const idx = parseInt(id.slice(-1));
        const wantAvl = 10 + idx;
        const wantPrice = 100 + idx * 10;
        if (day.availability !== wantAvl || day.finalPrice !== wantPrice) {
            throw RzError(`prop ${id}: got avl=${day.availability} price=${day.finalPrice}, want avl=${wantAvl} price=${wantPrice}`);
        }
    }
}

export async function checkDelRoomDayAndDateList(c: CacheClientAPI): Promise<void> {
    const prop = 'seg9_arA_p1';
    const room = 'single';
    const date = tomorrow();

    await c.delRoomDay({ propertyID: prop, roomType: room, date });
    await sleep(1000);

    const dates = await c.propRoomDateList({ propertyID: prop, roomType: room });
    if (dates.includes(date)) {
        throw RzError(`date ${date} still listed after delete`);
    }
}

export async function checkDelSegment(c: CacheClientAPI): Promise<void> {
    const seg = 'seg10';
    const before = await c.searchProp({ segment: seg });
    if (before.length === 0) {
        throw RzError(`nothing to delete for ${seg}`);
    }

    await c.delSegment(seg);
    await sleep(1000);

    await expect(c.searchProp({ segment: seg }))
        .rejects
        .toThrow(/NOT_FOUND/);

}

export async function checkDeletionCommands(c: CacheClientAPI): Promise<void> {
    const propID = 'seg9_arA_p1';
    const roomType = 'single';

    let exists = await c.propExist(propID);
    if (!exists) throw RzError(`PropExist failed for ${propID}`);

    exists = await c.propRoomExist({ propertyID: propID, roomType });
    if (!exists) throw RzError(`PropRoomExist failed for ${propID}/${roomType}`);

    try {
        await c.delPropRoom({ propertyID: propID, roomType });
    } catch (error) {
        throw RzError(`DelPropRoom failed for ${propID}/${roomType}`);
    }

    await sleep(1000);


    exists = await c.propRoomExist({ propertyID: propID, roomType });
    if (exists) throw RzError('PropRoomExist still true after DelPropRoom');

    const rooms = await c.propRoomList(propID);
    if (rooms.includes(roomType)) {
        throw RzError(`room ${roomType} still in list after DelPropRoom`);
    }

    await c.delProp(propID);
    await sleep(1000);

    exists = await c.propExist(propID);
    if (exists) throw RzError('PropExist still true after DelProp');

    const props = await c.searchProp({ segment: 'seg9' });
    if (props.includes(propID)) {
        throw RzError(`DelProp did not remove ${propID} from search`);
    }
}

export async function checkGetSegments(c: CacheClientAPI): Promise<void> {
    const segmentsInfo = await c.getSegments();
    const segments = segmentsInfo.map(s => s.segment).sort();
    const want = ['seg9', 'seg10'].sort();
    if (JSON.stringify(segments) !== JSON.stringify(want)) {
        throw RzError(`GetSegments got ${segments}, want ${want}`);
    }
}