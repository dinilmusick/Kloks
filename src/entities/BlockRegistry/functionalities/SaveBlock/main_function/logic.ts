import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        name: z.string(),
        blockType: z.enum(["concept", "entity", "functionality"]),
        category: z.string().optional(),
        description: z.string().optional(),
        version: z.string(),
        tags: z.array(z.string()).optional(),
        dependencies: z.object({
            npm: z.array(z.string()).optional(),
            kloksBlocks: z.array(z.string()).optional()
        }).optional(),
        files: z.record(z.string()).optional(),
        fingerprint: z.object({
            contentHash: z.string()
        }).optional(),
        metadata: z.record(z.any()).optional(),
        changelog: z.array(z.object({
            version: z.string(),
            timestamp: z.string(),
            description: z.string()
        })).optional()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        block: z.any().optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        
        // Fetch existing block to handle changelog updates
        const existingBlock = KloksStoreFuncs.getBlockById(db, input.id);
        
        let newChangelog = input.changelog || [];
        if (existingBlock) {
            // If the version is updated, add previous version to changelog
            if (existingBlock.version !== input.version) {
                const historyEntry = {
                    version: existingBlock.version,
                    timestamp: new Date().toISOString(),
                    description: `Updated to ${input.version}`
                };
                newChangelog = [...(existingBlock.changelog || []), historyEntry];
            } else {
                newChangelog = existingBlock.changelog || [];
            }
        }

        const blockData = {
            ...input,
            changelog: newChangelog
        };

        KloksStoreFuncs.upsertBlock(db, blockData);

        return {
            status: "success",
            message: `Block '${input.name}' saved successfully`,
            block: blockData
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
