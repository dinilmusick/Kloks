import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        KloksStoreFuncs.upsertCategory(db, input);
        return {
            status: "success",
            message: `Category '${input.name}' upserted successfully`
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
