import { RzError } from "../internal/err";
import { ErrorKind } from "../types";

export class ClusterConfig {
    seedHosts = '';
    apiPort = 0;
    tcpPort = 0;
    authToken = '';
    timeout = 2_000;        // ms
    httpTimeout = 5_000;     // ms
    keepAlive = 30_000;      // ms
    maxActiveConns = 100;

}

export class ClusterConfigBuilder {
    private config = new ClusterConfig();

    private constructor() { }

    static new(): ClusterConfigBuilder {
        return new ClusterConfigBuilder();
    }

    withSeedHosts(seeds: string): this {
        this.config.seedHosts = seeds.trim();
        return this;
    }

    withAPIPort(port: number): this {
        this.config.apiPort = port;
        return this;
    }

    withTCPPort(port: number): this {
        this.config.tcpPort = port;
        return this;
    }

    withToken(token: string): this {
        this.config.authToken = token;
        return this;
    }

    withTimeout(ms: number): this {
        this.config.timeout = ms;
        return this;
    }

    withHttpTimeout(ms: number): this {
        this.config.httpTimeout = ms;
        return this;
    }

    withKeepAlive(ms: number): this {
        this.config.keepAlive = ms;
        return this;
    }

    withMaxActiveConns(n: number): this {
        this.config.maxActiveConns = n > 0 ? n : 100;
        return this;
    }

    build(): ClusterConfig {
        const errors: string[] = [];

        if (!this.config.seedHosts) errors.push('at least one seed address is required');
        if (this.config.tcpPort === 0) errors.push('TCP port is required');
        if (this.config.apiPort === 0) errors.push('API port is required in clustered mode');
        if (!this.config.authToken) errors.push('authentication requires a token');

        if (errors.length > 0) {
            throw RzError(`ClusterConfig validation failed:\n  • ${errors.join('\n  • ')}`, ErrorKind.Client);
        }

        // Return a shallow clone + freeze for immutability
        return Object.freeze({ ...this.config });
    }
}