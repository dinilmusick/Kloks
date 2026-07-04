import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        blockId: z.string()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        usages: z.array(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const usages = KloksStoreFuncs.getUsageByBlock(db, input.blockId);
        return {
            status: "success",
            usages
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
