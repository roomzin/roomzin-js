# Roomzin Node.js SDK

Official Node.js SDK for [Roomzin](https://m-javani.github.io/roomzin-doc/) — a high-performance in-memory inventory engine for booking platforms.

The SDK provides a modern TypeScript API for communicating with Roomzin servers in both standalone and clustered deployments. It automatically handles connection management, request/response demuxing, and self-healing reconnections.

---

## Features

- Unified client for standalone and router (cluster) modes
- Built-in connection self-healing
- Automatic request routing (writes to leader, reads to followers) via router
- Fully typed TypeScript API
- Promise-based asynchronous API
- Reusable, concurrency-safe client
- Type-safe API with segment support

---

## Requirements

- Node.js 18 or later
- Roomzin Server v1.x
- Roomzin Router (for cluster mode)

---

## Installation

```bash
npm install roomzin-js
# or
yarn add roomzin-js
# or
pnpm add roomzin-js
```

---

## Client Setup

### Standalone Mode

Connect directly to a standalone Roomzin server:

```typescript
import { RoomzinClient, createRoomzinConfig, Mode } from 'roomzin-js';

const config = createRoomzinConfig()
    .withAddr('127.0.0.1')
    .withPort(7777)
    .withMode(Mode.STANDALONE)
    .withTimeout(5000)        // 5 seconds
    .withKeepAlive(30000)     // 30 seconds
    .build();

const client = new RoomzinClient(config);
await client.connect();

// Use client...
await client.close();
```

### Cluster Mode (via Router)

Connect to a Roomzin cluster through the router:

```typescript
import { RoomzinClient, createRoomzinConfig, Mode } from 'roomzin-js';

const config = createRoomzinConfig()
    .withAddr('router.example.com')
    .withPort(9200)
    .withMode(Mode.ROUTER)
    .withTimeout(30000)
    .withKeepAlive(30000)
    .build();

const client = new RoomzinClient(config);
await client.connect();
await client.close();
```

---

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `withAddr()` | Server or router address | Required |
| `withPort()` | TCP port | Required |
| `withMode()` | `Mode.STANDALONE` or `Mode.ROUTER` | `Mode.STANDALONE` |
| `withTimeout()` | Request timeout (ms) | 2000 |
| `withKeepAlive()` | TCP keep-alive interval (ms) | 30000 |

---

## Segment Routing

In cluster mode, every request must specify a segment. The router uses this to route the request to the correct shard.

```typescript
const segment = 'us-east';

// All API methods accept segment as a parameter
await client.setProp(segment, payload);
```

In standalone mode, the segment parameter is ignored but still required for API compatibility. This allows you to switch between standalone and cluster modes without changing your business logic.

---

## Property Management

### setProp
Adds or updates a property.

```typescript
await client.setProp('downtown', {
    segment: 'downtown',
    area: 'manhattan',
    propertyID: 'hotel_123',
    propertyType: 'hotel',
    category: 'luxury',
    stars: 4,
    latitude: 40.7128,
    longitude: -74.0060,
    amenities: ['wifi', 'pool', 'gym'],
});
```

### searchProp
Searches properties by segment, area, type, or location.

```typescript
// By segment
const ids = await client.searchProp('downtown', { segment: 'downtown' });

// By area
const ids = await client.searchProp('downtown', {
    segment: 'downtown',
    area: 'manhattan',
});

// By location (radius search)
const ids = await client.searchProp('downtown', {
    segment: 'downtown',
    latitude: 40.7128,
    longitude: -74.0060,
});
```

### propExist
Checks if a property exists.

```typescript
const exists = await client.propExist('downtown', 'hotel_123');
```

### propRoomExist
Checks if a specific room type exists for a property.

```typescript
const exists = await client.propRoomExist('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

### propRoomList
Lists all room types for a property.

```typescript
const rooms = await client.propRoomList('downtown', 'hotel_123');
```

### propRoomDateList
Lists dates with availability data for a property and room type.

```typescript
const dates = await client.propRoomDateList('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

---

## Room Package Management

### setRoomPkg
Sets availability, price, and rate features for a room type on a date.

```typescript
await client.setRoomPkg('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    availability: 10,
    finalPrice: 199,
    rateFeature: ['free_cancellation', 'breakfast_included'],
});
```

### setRoomAvl
Sets exact availability for a room type on a specific date.

```typescript
const newAvail = await client.setRoomAvl('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 20,
});
```

### incRoomAvl
Increases availability (e.g., on cancellation).

```typescript
const newAvail = await client.incRoomAvl('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 1,
});
```

### decRoomAvl
Decreases availability (e.g., on booking).

```typescript
const newAvail = await client.decRoomAvl('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
    amount: 2,
});
```

### getPropRoomDay
Gets availability and pricing for a specific room on a specific date.

```typescript
const day = await client.getPropRoomDay('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
});
console.log(`Avail: ${day.availability}, Price: ${day.finalPrice}`);
```

---

## Search & Query

### searchAvail
Searches available rooms by filters.

```typescript
const results = await client.searchAvail('downtown', {
    segment: 'downtown',
    roomType: 'suite',
    date: ['2026-07-20', '2026-07-21'],
    limit: 50,
    minPrice: 100,
    maxPrice: 300,
    amenities: ['wifi', 'pool'],
    rateFeature: ['free_cancellation'],
});

for (const result of results) {
    console.log(`Property: ${result.propertyID}`);
    for (const day of result.days) {
        console.log(`  ${day.date}: Avail ${day.availability}, Price ${day.finalPrice}`);
    }
}
```

### getCodecs
Gets the current codec registry (used internally for validation).

```typescript
const codecs = await client.getCodecs();
console.log(codecs.rateFeatures);
```

---

## Delete Operations

### delRoomDay
Deletes availability for a specific room on a specific date.

```typescript
await client.delRoomDay('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
    date: '2026-07-20',
});
```

### delPropDay
Deletes all data for a property on a specific date.

```typescript
await client.delPropDay('downtown', {
    propertyID: 'hotel_123',
    date: '2026-07-20',
});
```

### delPropRoom
Deletes a room type from a property.

```typescript
await client.delPropRoom('downtown', {
    propertyID: 'hotel_123',
    roomType: 'suite',
});
```

### delProp
Deletes an entire property.

```typescript
await client.delProp('downtown', 'hotel_123');
```

### delSegment
Deletes a segment and all properties within it.

```typescript
await client.delSegment('downtown');
```

---

## Error Handling

Every SDK operation may reject with a `RoomzinError`. Use the provided helper functions to classify errors:

```typescript
import { IsRequest, IsRetry, IsClient, IsInternal } from 'roomzin-js';

try {
    await client.setRoomPkg('downtown', payload);
} catch (err) {
    if (IsRequest(err)) {
        // Business rule violation - fix the request
        console.log('Request error:', err.code);
    } else if (IsRetry(err)) {
        // Temporary condition - retry with backoff
        await sleep(100);
        await client.setRoomPkg('downtown', payload);
    } else if (IsClient(err)) {
        // Authentication or protocol errors
        console.log('Client error:', err.message);
    } else if (IsInternal(err)) {
        // Unexpected server response
        throw new Error('Internal error', { cause: err });
    } else {
        // Fatal error
        throw err;
    }
}
```

### Error Categories

| Category | Description | Action |
|----------|-------------|--------|
| **Client** | Authentication or protocol errors | Check credentials and configuration |
| **Request** | Invalid input or business rule violation | Fix request, don't retry |
| **Retry** | Temporary server condition (429, 503) | Retry with backoff |
| **Internal** | Unexpected server response | Log and investigate |

---

## Client Lifecycle

Create a **single client** during application startup and reuse it throughout your application.

```typescript
// ✅ Good - create once, reuse
const client = new RoomzinClient(config);
await client.connect();
// Use client everywhere...
await client.close();

// ❌ Bad - creating per request
for (const req of requests) {
    const client = new RoomzinClient(config); // Don't do this
    await client.setRoomPkg('downtown', req);
    await client.close();
}
```

The client is safe for concurrent use and manages TCP connections internally.

---

## Architecture

### Standalone Mode

```
[SDK] → [Standalone Server]
```

- Single TCP connection
- Direct communication
- Self-healing on disconnection

### Cluster Mode

```
[SDK] → [Router] → [Shard Leader/Followers]
```

- SDK sends segment and isWrite flag in header
- Router routes writes to leader, reads to followers
- Router handles cluster topology
- SDK maintains single connection to router

### Protocol

The SDK uses a framed binary protocol:

**Standalone Frame:**
```
[0xFF][ClrID(4)][TotalLen(4)][Payload]
```

**Router Frame:**
```
[0xFE][TotalLen(4)][SegmentLen(1)][Segment(n)][IsWrite(1)][ShardFrame]
```

Where `ShardFrame` is the standalone frame format.

---

## Examples

A complete smoke example is available in the `examples/nodejs/` directory. It demonstrates the SDK's core features and can be run as a reference implementation or to verify your Roomzin setup.

```bash
cd examples/nodejs
npm install
npm start
```

---

## Documentation

For Roomzin concepts, deployment, and administration:

[https://m-javani.github.io/roomzin-doc/docs.html](https://m-javani.github.io/roomzin-doc/docs.html)

---

## Contributing

Contributions are welcome! Please open an issue before proposing large changes.

All contributions are subject to the BUSL-1.1 License terms.

---

## License

This SDK is licensed under the [BUSL-1.1 License](LICENSE).

**Note:** This SDK communicates with Roomzin Server, which requires a valid Roomzin license.

---

## Support

- **Documentation**: [roomzin-doc](https://m-javani.github.io/roomzin-doc/)
- **Community Q&A**: [GitHub Discussions](https://github.com/m-javani/roomzin-doc/discussions)
- **Issues**: [GitHub Issues](https://github.com/roomzin/roomzin-js/issues)
- **Security**: [mehdy.javany@gmail.com](mailto:mehdy.javany@gmail.com)

---

## Related Repositories

- [Roomzin Quickstart](https://github.com/m-javani/roomzin-quickstart) — Local Docker cluster
- [Roomzin Bench](https://github.com/m-javani/roomzin-bench) — Benchmarking tool
```
