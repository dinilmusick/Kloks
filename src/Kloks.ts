import { UpdateManager } from "./entities/UpdateManager/UpdateManager.ts";
import { BlockScanner } from "./entities/BlockScanner/BlockScanner.ts";
import { SearchEngine } from "./entities/SearchEngine/SearchEngine.ts";
import { BlockRegistry } from "./entities/BlockRegistry/BlockRegistry.ts";
import { krnlSystemEntityBase } from "krnlts";
import fs from "fs/promises";
import path from "path";
import net from "net";

export class Kloks extends krnlSystemEntityBase {
    constructor() {
        super("Kloks");
        this.addChild(new BlockRegistry(this));
        this.addChild(new SearchEngine(this));
        this.addChild(new BlockScanner(this));
        this.addChild(new UpdateManager(this));
        console.log("[Kloks] System Entity initialized.");
    }

    boot() {
        // Dummy method for KrnlMagneticLoader sub-app detection
    }

    private async isUdpPortAvailable(port: number, host = (this as any).host || "0.0.0.0"): Promise<boolean> {
        const dgram = await import("dgram").then((m: any) => m.default || m);
        return await new Promise<boolean>((resolve) => {
            const socket = dgram.createSocket({ type: "udp4" });
            const finalize = (available: boolean) => {
                try {
                    socket.close();
                } catch (_) {}
                resolve(available);
            };

            socket.once("error", () => finalize(false));
            socket.bind(port, host, () => finalize(true));
        });
    }

    private async isTcpPortAvailable(port: number, host = (this as any).host || "0.0.0.0"): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            const server = net.createServer();
            const finalize = (available: boolean) => {
                try {
                    server.close();
                } catch (_) {}
                resolve(available);
            };

            server.once("error", () => finalize(false));
            server.listen(port, host, () => finalize(true));
        });
    }

    private async pickDiscoveryPort(preferredPort = 10111, maxAttempts = 50): Promise<number> {
        const host = (this as any).host || "0.0.0.0";
        for (let offset = 0; offset < maxAttempts; offset++) {
            const candidate = preferredPort + offset;
            if (await this.isUdpPortAvailable(candidate, host)) {
                return candidate;
            }
        }
        throw new Error(`No free discovery port found in range [${preferredPort}, ${preferredPort + maxAttempts - 1}]`);
    }

    private async pickCommPort(preferredPort = 10098, maxAttempts = 50): Promise<number> {
        const host = (this as any).host || "0.0.0.0";
        for (let offset = 0; offset < maxAttempts; offset++) {
            const candidate = preferredPort + offset;
            if (await this.isTcpPortAvailable(candidate, host)) {
                return candidate;
            }
        }
        throw new Error(`No free comm port found in range [${preferredPort}, ${preferredPort + maxAttempts - 1}]`);
    }

    async start(krnlPort = Number(process.env.KRNL_PORT || 10098)) {
        const commPortStart = Number(process.env.KRNL_PORT || krnlPort || 10098);
        const commPort = await this.pickCommPort(commPortStart);
        if (commPort !== commPortStart) {
            console.log(`[Kloks] comm port ${commPortStart} was occupied. Using ${commPort}.`);
        }
        (this as any)._preferredPort = commPort;
        (this as any).commPort = commPort;
        (this as any).commComponent.listenPort = commPort;
        
        // Activate unified HTTP server (WS + REST + MCP + ACP)
        await (this as any).activateServiceSuite("UNIFIED_HTTP");

        if ((this as any).unifiedHttpAdapter) {
            (this as any).unifiedHttpAdapter.enableFriendlyRouting = true;
        }

        (this as any).bindProcessSignals();

        const discoveryPortStart = Number(process.env.KRNL_DISCOVERY_PORT || 10111);
        const discoveryPort = await this.pickDiscoveryPort(discoveryPortStart);
        await (this as any).startDiscovery(discoveryPort);

        // Introspection endpoint execute mapping
        (this as any).commComponent.defineRpc('execute', async (params: any) => {
            const { fid, data } = params;
            return await (this as any).call(fid, data);
        });

        // Write ports configuration snapshot
        const portsSnapshotPath = path.resolve(process.cwd(), "Kloks.ports.json");
        await fs.writeFile(portsSnapshotPath, JSON.stringify({
            entity: "Kloks",
            timestamp: new Date().toISOString(),
            ports: {
                _krnl_system: commPort
            }
        }, null, 2));

        console.log(`[Kloks] booted successfully on port ${commPort}`);
    }
}
