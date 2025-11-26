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

export async function getClusterInfo(cfg: HandlerConfig): Promise<{ leader: string; followers: string[] }> {
    const hosts = parseHosts(cfg.SeedHosts);

    interface Node {
        host: string;
        health: string;
        leaderURL: string;
    }

    const nodes: Node[] = [];

    await Promise.all(
        hosts.map(async (host) => {
            try {
                const health = await healthCheck(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);
                if (health === 'unavailable') return;

                const info = await getNodeInfo(host, cfg.APIPort, cfg.AuthToken, cfg.HttpTimeout);

                nodes.push({
                    host,
                    health,
                    leaderURL: info.leader_url,
                });
            } catch {
                // ignore dead nodes
            }
        })
    );

    let leader = '';
    const followers: string[] = [];

    for (const n of nodes) {
        switch (n.health) {
            case 'active_leader':
                leader = n.host;
                break;
            case 'active_follower':
                followers.push(n.host);
                break;
        }
    }

    if (!leader) {
        throw ErrNoLeaderAvailable;
    }

    return { leader, followers };
}