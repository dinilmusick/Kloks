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
        projectPath: z.string(),
        blockId: z.string()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        presence: z.enum(["NOT_FOUND", "MATCH", "OUTDATED", "MODIFIED"]).optional(),
        localVersion: z.string().optional(),
        registeredVersion: z.string().optional()
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
        const block = KloksStoreFuncs.getBlockById(db, input.blockId);
        if (!block) {
            return {
                status: "error",
                message: `Block '${input.blockId}' is not registered in the database`
            };
        }

        // Determine expected path in target project
        let searchDir = "";
        if (block.blockType === "concept") {
            searchDir = path.join(input.projectPath, "src", "libraries", block.name);
        } else if (block.blockType === "entity") {
            searchDir = path.join(input.projectPath, "src", "entities", block.name);
        } else if (block.blockType === "functionality") {
            // Find parent entity if any, or look at root
            const entitiesDir = path.join(input.projectPath, "src", "entities");
            let foundDir = "";
            if (fs.existsSync(entitiesDir)) {
                const entities = fs.readdirSync(entitiesDir);
                for (const ent of entities) {
                    const candidate = path.join(entitiesDir, ent, "functionalities", block.name);
                    if (fs.existsSync(candidate)) {
                        foundDir = candidate;
                        break;
                    }
                }
            }
            if (!foundDir) {
                const candidate = path.join(input.projectPath, "src", "functionalities", block.name);
                if (fs.existsSync(candidate)) {
                    foundDir = candidate;
                }
            }
            searchDir = foundDir;
        }

        if (!searchDir || !fs.existsSync(searchDir)) {
            return {
                status: "success",
                presence: "NOT_FOUND",
                registeredVersion: block.version
            };
        }

        // Compute local fingerprint
        const files = readDirRecursive(searchDir);
        const hash = crypto.createHash("sha256");
        const sortedKeys = Object.keys(files).sort();
        for (const key of sortedKeys) {
            hash.update(key);
            hash.update(files[key]);
        }
        const localHash = hash.digest("hex");

        // Compare to current registered fingerprint
        if (localHash === block.fingerprint?.contentHash) {
            return {
                status: "success",
                presence: "MATCH",
                localVersion: block.version,
                registeredVersion: block.version
            };
        }

        // Check if it matches a historical version
        const matchesHistory = (block.changelog || []).find((entry: any) => entry.contentHash === localHash);
        if (matchesHistory) {
            return {
                status: "success",
                presence: "OUTDATED",
                localVersion: matchesHistory.version,
                registeredVersion: block.version
            };
        }

        // Otherwise it is modified
        return {
            status: "success",
            presence: "MODIFIED",
            localVersion: "unknown-modified",
            registeredVersion: block.version
        };

    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
