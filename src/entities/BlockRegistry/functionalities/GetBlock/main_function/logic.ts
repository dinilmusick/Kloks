import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string()
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
        const block = KloksStoreFuncs.getBlockById(db, input.id);
        if (!block) {
            return {
                status: "error",
                message: `Block with id '${input.id}' not found`
            };
        }
        return {
            status: "success",
            block
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
