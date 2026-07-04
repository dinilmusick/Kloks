import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        blockId: z.string(),
        limit: z.number().int().positive().optional().default(5)
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        related: z.array(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const targetBlock = KloksStoreFuncs.getBlockById(db, input.blockId);
        if (!targetBlock) {
            return {
                status: "error",
                message: `Block with id '${input.blockId}' not found`
            };
        }

        // Fetch all blocks
        const allBlocks = KloksStoreFuncs.listBlocks(db);

        // Score relatedness
        const scored = allBlocks
            .filter(b => b.id !== targetBlock.id)
            .map(b => {
                let score = 0;
                // Category match
                if (b.category === targetBlock.category) {
                    score += 5;
                }
                // Tag match count
                const commonTags = b.tags.filter((t: string) => targetBlock.tags.includes(t));
                score += commonTags.length * 2;

                return { block: b, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.block);

        return {
            status: "success",
            related: scored.slice(0, input.limit)
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
