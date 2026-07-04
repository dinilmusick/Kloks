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
        message: z.string().optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const success = KloksStoreFuncs.deleteBlock(db, input.id);
        if (!success) {
            return {
                status: "error",
                message: `Block with id '${input.id}' not found or could not be deleted`
            };
        }
        return {
            status: "success",
            message: `Block with id '${input.id}' deleted successfully`
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
