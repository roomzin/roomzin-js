import {
    RoomzinClient,
    RoomzinConfig,
    createRoomzinConfig,
    Mode,
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
} from '../../src';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Change to "router" to test against a Roomzin cluster via router
// or "standalone" for direct connection to a standalone server
const MODE = "router";

// Standalone configuration
const STANDALONE_HOST = "127.0.0.1";
const STANDALONE_PORT = 7777;
const TIMEOUT = 5000; // ms

// Cluster configuration (router address)
const ROUTER_HOST = "127.0.0.1";
const ROUTER_PORT = 9200;

// Test data parameters - matches generator.py
const NUM_SEGMENTS = 4;
const NUM_PROPS_PER_SEGMENT = 10;
const NUM_ROOMS_PER_PROP = 4;
const NUM_DAYS = 10;
const SHARD_IDX = 1;

// ============================================================================
// TIMING HELPERS
// ============================================================================

interface StepTiming {
    name: string;
    duration: number;
    requestCount: number;
}

const timings: StepTiming[] = [];

function timeStep(name: string, requestCount: number, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    return fn()
        .then(() => {
            const duration = Date.now() - start;
            timings.push({ name, duration, requestCount });
            console.log(`  ✅ ${name} completed in ${duration}ms (${requestCount} requests)`);
        })
        .catch((err) => {
            const duration = Date.now() - start;
            timings.push({ name, duration, requestCount });
            console.log(`  ❌ ${name} failed after ${duration}ms`);
            throw err;
        });
}

function printSummary(): void {
    console.log("\n" + "=".repeat(60));
    console.log("  TIMING SUMMARY");
    console.log("=".repeat(60));

    let totalTime = 0;
    let totalRequests = 0;

    for (const t of timings) {
        totalTime += t.duration;
        totalRequests += t.requestCount;
        console.log(`  ${t.name.padEnd(25)} ${String(t.duration).padStart(10)}ms  ${String(t.requestCount).padStart(4)} requests`);
    }

    console.log("-".repeat(60));
    console.log(`  ${"TOTAL:".padEnd(25)} ${String(totalTime).padStart(10)}ms  ${String(totalRequests).padStart(4)} requests`);
    console.log(`  ${"Avg per request:".padEnd(25)} ${String(Math.round(totalTime / totalRequests)).padStart(10)}ms`);
    console.log("=".repeat(60));
}

async function waitForCondition(timeout: number, condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: Error | undefined;
    while (Date.now() < deadline) {
        try {
            if (await condition()) {
                return;
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (lastError) {
        throw lastError;
    }
    throw new Error(`Condition not met within ${timeout}ms`);
}

// ============================================================================
// CLIENT CREATION
// ============================================================================

async function createClient(): Promise<RoomzinClient> {
    let config: RoomzinConfig;
    if (MODE.toLowerCase() === 'standalone') {
        config = createRoomzinConfig()
            .withAddr(STANDALONE_HOST)
            .withPort(STANDALONE_PORT)
            .withMode(Mode.STANDALONE)
            .withTimeout(TIMEOUT)
            .withKeepAlive(30000)
            .build();
    } else {
        config = createRoomzinConfig()
            .withAddr(ROUTER_HOST)
            .withPort(ROUTER_PORT)
            .withMode(Mode.ROUTER)
            .withTimeout(30000)
            .withKeepAlive(30000)
            .build();
    }

    const client = new RoomzinClient(config);
    await client.connect();
    return client;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
    console.log("=== Roomzin API Example ===");
    console.log(`Mode: ${MODE}\n`);

    try {
        // -------------------------------------------------------------------------
        // STEP 1: Connect to Roomzin
        // -------------------------------------------------------------------------
        console.log("[1/8] Connecting to Roomzin...");

        const client = await createClient();
        const codecs = await client.getCodecs();
        console.log(`codecs ${codecs.rateFeatures.join(', ')}`);

        // -------------------------------------------------------------------------
        // STEP 2: Create properties and verify existence
        // -------------------------------------------------------------------------
        console.log("\n[2/8] SetProp...");

        await timeStep("SetProp", NUM_SEGMENTS * NUM_PROPS_PER_SEGMENT, async () => {
            const createdProps: string[] = [];

            for (let s = 1; s <= NUM_SEGMENTS; s++) {
                const segment = `segment_${s}`;

                for (let p = 1; p <= NUM_PROPS_PER_SEGMENT; p++) {
                    const propID = `s${SHARD_IDX}_seg${s}_p${p}`;

                    const lat = 40.7128 + p * 0.001;
                    const lon = -74.0060 + p * 0.001;
                    const amenities = ["wifi", "pool"];

                    const payload: SetPropPayload = {
                        segment: segment,
                        area: `area_${SHARD_IDX}_${s}`,
                        propertyID: propID,
                        propertyType: "hotel",
                        category: "midrange",
                        stars: 3,
                        latitude: lat,
                        longitude: lon,
                        amenities: amenities
                    };

                    await client.setProp(segment, payload);
                    createdProps.push(propID);
                }
            }

            // check PropExist
            const p1 = createdProps[0];
            const segment = "segment_1";
            await waitForCondition(2000, async () => {
                return await client.propExist(segment, p1);
            });
        });

        // -------------------------------------------------------------------------
        // STEP 3: Set room packages and verify rooms/dates
        // -------------------------------------------------------------------------
        console.log("\n[3/8] SetRoomPkg...");

        await timeStep("SetRoomPkg", NUM_SEGMENTS * NUM_PROPS_PER_SEGMENT * NUM_ROOMS_PER_PROP * NUM_DAYS, async () => {
            // Generate dates - start from today (matches generator)
            const dates: string[] = [];
            for (let i = 0; i < NUM_DAYS; i++) {
                const date = new Date();
                date.setDate(date.getDate() + i);
                dates.push(date.toISOString().split('T')[0]);
            }

            // Set packages for all properties
            for (let s = 1; s <= NUM_SEGMENTS; s++) {
                const segment = `segment_${s}`;

                for (let p = 1; p <= NUM_PROPS_PER_SEGMENT; p++) {
                    const propID = `s${SHARD_IDX}_seg${s}_p${p}`;

                    for (let r = 1; r <= NUM_ROOMS_PER_PROP; r++) {
                        const roomType = `room${r}`;

                        for (const date of dates) {
                            const avail = 10 + p;
                            const price = 100 + p * 10;
                            const rateFeatures = ["free_cancellation", "free_wifi"];

                            const payload: SetRoomPkgPayload = {
                                propertyID: propID,
                                roomType: roomType,
                                date: date,
                                availability: avail,
                                finalPrice: price,
                                rateFeature: rateFeatures
                            };

                            await client.setRoomPkg(segment, payload);
                        }
                    }
                }
            }

            // Verify room lists for first property
            const testProp = `s${SHARD_IDX}_seg1_p1`;
            const segment = "segment_1";

            const rooms = await client.propRoomList(segment, testProp);
            const expectedRooms = ["room1", "room2", "room3", "room4"];
            if (rooms.length !== expectedRooms.length) {
                throw new Error(`expected ${expectedRooms.length} rooms, got ${rooms.length}`);
            }

            // Verify date lists for first room
            const testRoom = "room1";
            const dateListPayload: PropRoomDateListPayload = {
                propertyID: testProp,
                roomType: testRoom
            };
            const dateList = await client.propRoomDateList(segment, dateListPayload);

            if (dateList.length !== NUM_DAYS) {
                throw new Error(`expected ${NUM_DAYS} dates, got ${dateList.length}`);
            }
            console.log(`        PropRoomDateList: ${dateList.join(', ')}`);

            // Spot check: get a specific room/day
            const getDayPayload: GetRoomDayRequest = {
                propertyID: testProp,
                roomType: testRoom,
                date: dates[0]
            };
            await client.getPropRoomDay(segment, getDayPayload);
        });

        // -------------------------------------------------------------------------
        // STEP 4: Test SetRoomAvl, IncRoomAvl, DecRoomAvl
        // -------------------------------------------------------------------------
        console.log("\n[4/8] Update Availability...");

        await timeStep("Update Availability", 4, async () => {
            const testDate = new Date().toISOString().split('T')[0];
            const testProp = `s${SHARD_IDX}_seg1_p1`;
            const testRoom = "room1";
            const segment = "segment_1";

            // Get initial availability
            const getDayPayload: GetRoomDayRequest = {
                propertyID: testProp,
                roomType: testRoom,
                date: testDate
            };
            const initial = await client.getPropRoomDay(segment, getDayPayload);
            console.log(`        GetPropRoomDay: avail=${initial.availability}, price=${initial.finalPrice}`);

            // SetRoomAvl
            const newAvail = 20;
            const setAvlPayload: UpdRoomAvlPayload = {
                propertyID: testProp,
                roomType: testRoom,
                date: testDate,
                amount: newAvail
            };
            await client.setRoomAvl(segment, setAvlPayload);
            console.log(`        SetRoomAvl: ${initial.availability} → ${newAvail}`);

            // IncRoomAvl
            const incPayload: UpdRoomAvlPayload = {
                propertyID: testProp,
                roomType: testRoom,
                date: testDate,
                amount: 1
            };
            const incResult = await client.incRoomAvl(segment, incPayload);
            console.log(`        IncRoomAvl: ${newAvail} → ${incResult}`);

            // DecRoomAvl
            const decPayload: UpdRoomAvlPayload = {
                propertyID: testProp,
                roomType: testRoom,
                date: testDate,
                amount: 1
            };
            const decResult = await client.decRoomAvl(segment, decPayload);
            console.log(`        DecRoomAvl: ${incResult} → ${decResult}`);
        });

        // -------------------------------------------------------------------------
        // STEP 5: Search availability and verify results
        // -------------------------------------------------------------------------
        console.log("\n[5/8] SearchAvail...");

        await timeStep("SearchAvail", 1, async () => {
            const date = new Date().toISOString().split('T')[0];
            const limit = 100;
            const maxPrice = 150;

            const payload: SearchAvailPayload = {
                segment: "segment_1",
                roomType: "room1",
                date: [date],
                finalPrice: maxPrice,
                limit: limit
            };

            const results = await client.searchAvail("segment_1", payload);
            console.log(`        Found ${results.length} properties with max price ${maxPrice}`);
        });

        // -------------------------------------------------------------------------
        // STEP 6: Test deletion commands (in sequence)
        // -------------------------------------------------------------------------
        console.log("\n[6/8] Deletion commands...");

        await timeStep("Deletion", 8, async () => {
            const segment = "segment_1";
            const testProp = `s${SHARD_IDX}_seg1_p1`;
            const testRoom = "room1";
            const testDate = new Date().toISOString().split('T')[0];

            // 6.1: DelRoomDay
            console.log("        DelRoomDay...");
            const delRoomPayload1: DelRoomDayRequest = {
                propertyID: testProp,
                roomType: testRoom,
                date: testDate
            };
            await client.delRoomDay(segment, delRoomPayload1);

            // Verify date was removed
            await waitForCondition(2000, async () => {
                const dateListPayload: PropRoomDateListPayload = {
                    propertyID: testProp,
                    roomType: testRoom
                };
                const dateList = await client.propRoomDateList(segment, dateListPayload);
                return !dateList.includes(testDate);
            });

            // 6.2: DelPropRoom
            console.log("        DelPropRoom...");
            const delRoomPayload2: DelPropRoomPayload = {
                propertyID: testProp,
                roomType: testRoom
            };
            await client.delPropRoom(segment, delRoomPayload2);

            // Verify room was removed
            await waitForCondition(2000, async () => {
                const existPayload: PropRoomExistPayload = {
                    propertyID: testProp,
                    roomType: testRoom
                };
                return !await client.propRoomExist(segment, existPayload);
            });

            // 6.3: DelProp
            console.log("        DelProp...");
            await client.delProp(segment, testProp);

            // Verify property was removed
            await waitForCondition(2000, async () => {
                return !await client.propExist(segment, testProp);
            });

            // 6.4: DelSegment
            console.log("        DelSegment...");
            await client.delSegment("segment_1");

            // Verify segment was removed
            await waitForCondition(2000, async () => {
                const searchPayload: SearchPropPayload = {
                    segment: "segment_1"
                };
                const props = await client.searchProp("segment_1", searchPayload);
                return props.length === 0;
            });
        });

        // -------------------------------------------------------------------------
        // STEP 7: Clean up remaining data
        // -------------------------------------------------------------------------
        console.log("\n[7/8] Cleaning up...");

        await timeStep("Cleanup", 3, async () => {
            for (let s = 2; s <= NUM_SEGMENTS; s++) {
                const seg = `segment_${s}`;
                try {
                    await client.delSegment(seg);
                    console.log(`        Cleaned up ${seg}`);
                } catch (err) {
                    console.log(`Warning: Failed to delete ${seg}: ${err}`);
                }
            }
        });

        // -------------------------------------------------------------------------
        // SUMMARY
        // -------------------------------------------------------------------------
        printSummary();
        console.log("\n✅ All completed successfully!");

        await client.close();

    } catch (err) {
        console.error("Fatal error:", err);
        process.exit(1);
    }
}

main();