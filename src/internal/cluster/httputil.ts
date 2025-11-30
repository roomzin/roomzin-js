import { HandlerConfig } from "./handler";

export class ClusterError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ClusterError';
    }
}

export const ErrNoLeaderAvailable = new ClusterError('no leader found in seed list');

export interface NodeInfo {
    node_id: string;
    zone_id: string;
    shard_id: string;
    leader_id: string;
    leader_url: string;
}

function parseHosts(s: string): string[] {
    return s
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h !== '');
}

async function httpGet<T = any>(
    host: string,
    port: number,
    path: string,
    authToken: string,
    timeoutMs: number
): Promise<T> {
    const url = `http://${host}:${port}${path}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new ClusterError(`http ${res.status}`);
        }

        return (await res.json()) as T;
    } finally {
        clearTimeout(tid);
    }
}

export async function getNodeInfo(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<NodeInfo> {
    return httpGet<NodeInfo>(host, port, '/node-info', authToken, timeoutMs);
}

export async function healthCheck(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<string> {
    const url = `http://${host}:${port}/healthz`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const res = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new ClusterError(`healthz ${res.status}`);
        }

        const text = await res.text();
        return text.trim();
    } finally {
        clearTimeout(tid);
    }
}

async function getPeers(
    host: string,
    port: number,
    authToken: string,
    timeoutMs: number
): Promise<string[]> {
    try {
        return await httpGet<string[]>(host, port, '/peers', authToken, timeoutMs);
    } catch {
        return [];
    }
}

export async function getClusterInfo(cfg: HandlerConfig): Promise<{ leader: string; followers: string[] }> {
    const hosts = parseHosts(cfg.SeedHosts);

    interface Node {
        host: string;
        health: string;
        leaderURL: string;
    }

    const existing = new Set(hosts);
    const discovered = new Map<string, boolean>(); // FIX: Use Map to track state
    const nodes = new Map<string, Node>();

    // First phase: collect all node information and discover peers
    const firstPhasePromises = hosts.map(async (host) => {
        try {
            const health = await healthCheck(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);
            if (health === 'unavailable') return;

            const info = await getNodeInfo(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);

            nodes.set(host, {
                host,
                health,
                leaderURL: info.leader_url,
            });
        } catch {
            // ignore dead nodes for health/node-info, but still try to discover peers
        }

        // FIX: Peer discovery happens regardless of node info success
        try {
            const peers = await getPeers(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);
            for (const peer of peers) {
                if (!existing.has(peer)) {
                    // FIX: Thread-safe discovery tracking
                    discovered.set(peer, true);
                }
            }
        } catch {
            // ignore peer discovery failures
        }
    });

    await Promise.all(firstPhasePromises);

    // Second phase: check newly discovered nodes
    if (discovered.size > 0) {
        const discoveredHosts = Array.from(discovered.keys());
        const secondPhasePromises = discoveredHosts.map(async (host) => {
            try {
                const health = await healthCheck(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);
                if (health === 'unavailable') return;

                const info = await getNodeInfo(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);

                nodes.set(host, {
                    host,
                    health,
                    leaderURL: info.leader_url,
                });
            } catch {
                // ignore dead nodes
            }
        });

        await Promise.all(secondPhasePromises);
    }

    // Third phase: determine leader using voting system
    const votes = new Map<string, number>();

    // Count votes for each leader URL
    for (const node of nodes.values()) {
        if (node.leaderURL) {
            votes.set(node.leaderURL, (votes.get(node.leaderURL) || 0) + 1);
        }
    }

    // Find the leader URL with most votes
    let leaderURL = '';
    let maxVotes = 0;
    for (const [url, count] of votes.entries()) {
        if (count > maxVotes) {
            maxVotes = count;
            leaderURL = url;
        }
    }

    if (!leaderURL) {
        throw RzError(err)NoLeaderAvailable;
    }

    // Find the actual leader host and trusted followers
    let leader = '';
    const followers: string[] = [];

    for (const node of nodes.values()) {
        if (node.leaderURL === leaderURL) {
            if (node.health === 'active_leader') {
                leader = node.host;
            } else if (node.health === 'active_follower') {
                followers.push(node.host);
            }
        }
    }

    if (!leader) {
        throw RzError(err)NoLeaderAvailable;
    }

    return { leader, followers };
}