import { CacheClientAPI } from '../src/api/client';
import { ClusterConfigBuilder } from './../src/cluster/config';
import { ClusterClient } from './../src/cluster'

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

async function getClusterClient(): Promise<CacheClientAPI> {
    const cfg = ClusterConfigBuilder.new()
        .withSeedHosts('172.20.0.10,172.20.0.11,172.20.0.12')
        .withAPIPort(8080)
        .withTCPPort(7777)
        .withToken('abc123')
        .withTimeout(5000)
        .withHttpTimeout(5000)
        .withKeepAlive(30_000)
        .withMaxActiveConns(100)
        .build();

    return await ClusterClient.create(cfg);
}

describe('Roomzin – Full Cluster Flow', () => {
    let client: CacheClientAPI;

    // Create client once before the test
    beforeAll(async () => {
        client = await getClusterClient();
        console.log('Connected to Roomzin cluster');
    }, 20_000); // give it time to connect

    // This is the most important part
    afterAll(async () => {
        if (client) {
            await (client as any).close?.();
        }
        // Give Node.js a moment to flush sockets
        await new Promise(r => setTimeout(r, 100));
    }, 10_000);

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
            throw err;
        }
    }, 30_000);
});