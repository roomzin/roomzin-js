import { describe, test, beforeAll, afterAll } from '@jest/globals';
import { CacheClientAPI } from '../src/api/client';
import { ClusterConfigBuilder } from '../src/cluster/config';
import { ClusterClient } from '../src/cluster';


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

function tomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

describe('Roomzin – Search Availability', () => {
    let client: CacheClientAPI;

    // Create client once before the test
    beforeAll(async () => {
        client = await getClusterClient();
        console.log('Connected to Roomzin cluster for search tests');
    }, 20_000);

    afterAll(async () => {
        if (client) {
            await (client as any).close?.();
        }
        // Give Node.js a moment to flush sockets
        await new Promise(r => setTimeout(r, 100));
    }, 10_000);

    test('search availability with amenities filter', async () => {
        const start = Date.now();

        const limit = 5;
        const results: number[] = [];

        // Run 20 searches
        const tm = tomorrow();
        for (let i = 0; i < 20; i++) {
            try {
                const avail = await client.searchAvail({
                    segment: 'seg9',
                    roomType: 'single',
                    date: [tm],
                    limit,
                    amenities: ['pool'],
                    rateFeature: ['free_cancellation'],
                });

                if (avail.length === 0) {
                    console.log('expected at least one result with pool');
                }
                console.log(avail.length);
                results.push(avail.length);
            } catch (err) {
                console.error(err);
                // Continue with next iteration like the Go test
            }
        }

        const duration = Date.now() - start;
        console.log(`Search test took: ${duration}ms`);
        console.log(`Results counts: ${results.join(', ')}`);

        // Optional: Add some assertions
        expect(results.length).toBe(20); // Should have attempted 20 searches
    }, 30_000);
});