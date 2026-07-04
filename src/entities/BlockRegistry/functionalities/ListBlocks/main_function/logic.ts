import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        blockType: z.enum(["concept", "entity", "functionality"]).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().optional()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        blocks: z.array(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const blocks = KloksStoreFuncs.listBlocks(db, input);
        return {
            status: "success",
            blocks
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
