import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        projectPath: z.string(),
        blockType: z.enum(["concept", "entity", "functionality"]),
        name: z.string(),
        category: z.string().optional(),
        description: z.string().optional(),
        version: z.string().default("1.0.0"),
        tags: z.array(z.string()).optional()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        block: z.any().optional()
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
            // Read as text
            filesMap[relativePath] = fs.readFileSync(path.join(baseDir, relativePath), "utf8");
        }
    }
    return filesMap;
}

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const { projectPath, blockType, name, category, description, version, tags } = input;
        
        let searchDir = "";
        let finalName = name;

        let isSingleFile = false;
        let singleFilePath = "";
        let singleFileDestName = "";

        if (blockType === "concept") {
            if (!finalName.endsWith("Concepts")) {
                finalName = `${finalName}Concepts`;
            }
            searchDir = path.join(projectPath, "src", "libraries", finalName);
            if (!fs.existsSync(searchDir)) {
                // Try file fallbacks
                const legacyName = name.replace("Concepts", "");
                const candidates = [
                    { path: path.join(projectPath, "src", "libraries", `${finalName}.ts`), dest: `${finalName}.ts` },
                    { path: path.join(projectPath, "src", "libraries", `${legacyName}.ts`), dest: `${finalName}.ts` },
                    { path: path.join(projectPath, "src", "libraries", `${finalName}.js`), dest: `${finalName}.js` },
                    { path: path.join(projectPath, "src", "libraries", `${legacyName}.js`), dest: `${finalName}.js` }
                ];
                for (const cand of candidates) {
                    if (fs.existsSync(cand.path)) {
                        isSingleFile = true;
                        singleFilePath = cand.path;
                        singleFileDestName = cand.dest;
                        break;
                    }
                }
            }
        } else if (blockType === "entity") {
            searchDir = path.join(projectPath, "src", "entities", finalName);
        } else if (blockType === "functionality") {
            // Try inside entities first
            const entitiesDir = path.join(projectPath, "src", "entities");
            let foundDir = "";
            if (fs.existsSync(entitiesDir)) {
                const entities = fs.readdirSync(entitiesDir);
                for (const ent of entities) {
                    const candidate = path.join(entitiesDir, ent, "functionalities", finalName);
                    if (fs.existsSync(candidate)) {
                        foundDir = candidate;
                        break;
                    }
                }
            }
            // Try in root level functionalities if not found in entities
            if (!foundDir) {
                const candidate = path.join(projectPath, "src", "functionalities", finalName);
                if (fs.existsSync(candidate)) {
                    foundDir = candidate;
                }
            }
            searchDir = foundDir;
        }

        if (!isSingleFile && (!searchDir || !fs.existsSync(searchDir))) {
            return {
                status: "error",
                message: `Block directory or file not found for ${blockType} '${name}' in ${projectPath}`
            };
        }

        // Read files
        let files: Record<string, string> = {};
        if (isSingleFile) {
            files[singleFileDestName] = fs.readFileSync(singleFilePath, "utf8");
        } else {
            files = readDirRecursive(searchDir);
        }
        
        // Calculate hash of all combined file contents
        const hash = crypto.createHash("sha256");
        const sortedKeys = Object.keys(files).sort();
        for (const key of sortedKeys) {
            hash.update(key);
            hash.update(files[key]);
        }
        const contentHash = hash.digest("hex");

        // Simple dependency scan in files
        const npmDeps = new Set<string>();
        const kloksDeps = new Set<string>();

        // Parse package.json of the project to find potential package matches
        let projectPackages: string[] = [];
        try {
            const pkgPath = path.join(projectPath, "package.json");
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                projectPackages = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
            }
        } catch (e) {}

        for (const fileContent of Object.values(files)) {
            // Look for imports
            const importMatches = fileContent.matchAll(/import\s+.*?\s+from\s+["'](.*?)["']/g);
            for (const match of importMatches) {
                const importPath = match[1];
                if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
                    // Looks like npm dependency or absolute path
                    if (projectPackages.includes(importPath)) {
                        npmDeps.add(importPath);
                    }
                } else if (importPath.includes("Concepts")) {
                    // Try to guess a local concept dependency
                    const parts = importPath.split("/");
                    const conceptName = parts.find(p => p.endsWith("Concepts"));
                    if (conceptName) {
                        kloksDeps.add(conceptName);
                    }
                }
            }
        }

        // Construct block
        const block = {
            id: `${blockType}:${finalName.toLowerCase()}`,
            name: finalName,
            blockType,
            category: category || "utilities",
            description: description || `Extracted ${blockType} ${finalName}`,
            version,
            tags: tags || [blockType],
            dependencies: {
                npm: Array.from(npmDeps),
                kloksBlocks: Array.from(kloksDeps)
            },
            files,
            fingerprint: {
                contentHash
            },
            metadata: {
                extractedFrom: projectPath,
                extractedAt: new Date().toISOString()
            },
            changelog: [
                {
                    version,
                    timestamp: new Date().toISOString(),
                    description: "Initial extraction"
                }
            ]
        };

        // Save block to database
        const db = KloksStoreFuncs.getDb();
        KloksStoreFuncs.upsertBlock(db, block);

        return {
            status: "success",
            message: `Successfully extracted and registered ${blockType} block '${finalName}'`,
            block
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
