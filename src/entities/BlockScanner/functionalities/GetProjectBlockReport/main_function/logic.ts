import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as ScannerData, FUNCTIONS as ScannerFuncs } from "../../../../../libraries/ScannerConcepts/ScannerConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        projectPath: z.string()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        report: z.object({
            matched: z.array(z.any()),
            outdated: z.array(z.any()),
            modified: z.array(z.any()),
            unregistered: z.array(z.any())
        }).optional()
    })
};

// Helper function to recursively read files in a directory
function readDirRecursive(baseDir: string, currentDir: string = ""): Record<string, string> {
    const filesMap: Record<string, string> = {};
    const fullPath = path.join(baseDir, currentDir);
    if (!fs.existsSync(fullPath)) return filesMap;

    const list = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const item of list) {
        const relativePath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
            Object.assign(filesMap, readDirRecursive(baseDir, relativePath));
        } else if (item.isFile()) {
            filesMap[relativePath] = fs.readFileSync(path.join(baseDir, relativePath), "utf8");
        }
    }
    return filesMap;
}

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const walk = ScannerFuncs.walkKrnlProject(input.projectPath);

        const matched: any[] = [];
        const outdated: any[] = [];
        const modified: any[] = [];
        const unregistered: any[] = [];

        const allBlocks = [
            ...walk.libraries.map((l: any) => ({ ...l, type: "concept" })),
            ...walk.entities.map((e: any) => ({ ...e, type: "entity" })),
            ...walk.functionalities.map((f: any) => ({ ...f, type: "functionality" }))
        ];

        for (const item of allBlocks) {
            const blockId = `${item.type}:${item.name.toLowerCase()}`;
            const registeredBlock = KloksStoreFuncs.getBlockById(db, blockId);

            if (!registeredBlock) {
                unregistered.push({
                    name: item.name,
                    type: item.type,
                    path: item.path
                });
                continue;
            }

            // Compute local fingerprint
            const files = readDirRecursive(item.path);
            const hash = crypto.createHash("sha256");
            const sortedKeys = Object.keys(files).sort();
            for (const key of sortedKeys) {
                hash.update(key);
                hash.update(files[key]);
            }
            const localHash = hash.digest("hex");

            const blockInfo = {
                id: registeredBlock.id,
                name: registeredBlock.name,
                type: registeredBlock.blockType,
                path: item.path,
                localVersion: registeredBlock.version,
                registeredVersion: registeredBlock.version
            };

            if (localHash === registeredBlock.fingerprint?.contentHash) {
                matched.push(blockInfo);
            } else {
                // Check if it matches a historical version in changelog
                const matchesHistory = (registeredBlock.changelog || []).find((entry: any) => entry.contentHash === localHash);
                if (matchesHistory) {
                    blockInfo.localVersion = matchesHistory.version;
                    outdated.push(blockInfo);
                } else {
                    blockInfo.localVersion = "unknown-modified";
                    modified.push(blockInfo);
                }
            }
        }

        return {
            status: "success",
            report: {
                matched,
                outdated,
                modified,
                unregistered
            }
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
