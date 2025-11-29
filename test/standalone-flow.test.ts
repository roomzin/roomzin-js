import { SingleClient } from '../src/single';
import { CacheClientAPI } from '../src/api/client';

import {
    seedTestData,
    updateAvailTestData,
    checkSegmentIsolation,
    checkAmenitiesAndCancel,
    checkPropRoomList,
    checkDateLists,
    checkGeoSearch,
    checkDelRoomDayAndDateList,
    checkDeletionCommands,
    checkGetSegments,
    checkDelSegment,
} from './utils';

async function getClient(): Promise<CacheClientAPI> {
    return await SingleClient.create({
        host: '127.0.0.1',
        tcpPort: 7777,
        authToken: 'abc123',
        timeout: 5000,        // 5 seconds
        keepAlive: 30_000,    // 30 seconds
    });
}

describe('Roomzin Cache – Full Standalone Flow', () => {
    let client: CacheClientAPI;

    beforeAll(async () => {
        client = await getClient();
        console.log('Connected to Roomzin standalone server');
    }, 10_000);

    afterAll(async () => {
        await client.close?.();
        console.log('Client closed');
    });

    test('complete end-to-end flow', async () => {
        const start = Date.now();

        try {
            await seedTestData(client);
            await updateAvailTestData(client);
            await checkSegmentIsolation(client);
            await checkAmenitiesAndCancel(client);
            await checkPropRoomList(client);
            await checkDateLists(client);
            await checkGeoSearch(client);
            await checkDelRoomDayAndDateList(client);
            await checkDeletionCommands(client);
            await checkGetSegments(client);
            await checkDelSegment(client);

            const duration = Date.now() - start;
            console.log(`Whole test took: ${duration}ms`);
        } catch (err) {
            const duration = Date.now() - start;
            console.log(`Test failed after ${duration}ms`);
            throw err; // Jest will mark it as failed
        }
    }, 90_000); // 90 second timeout (same as Go)
});