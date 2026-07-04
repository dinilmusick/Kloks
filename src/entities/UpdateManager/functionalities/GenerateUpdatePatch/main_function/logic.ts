import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as UpdateManagerData, FUNCTIONS as UpdateManagerFuncs } from "../../../../../libraries/UpdateManagerConcepts/UpdateManagerConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        blockId: z.string(),
        projectPath: z.string()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        patch: z.any().optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const block = KloksStoreFuncs.getBlockById(db, input.blockId);
        if (!block) {
            return {
                status: "error",
                message: `Block '${input.blockId}' is not registered`
            };
        }

        const patch = UpdateManagerFuncs.buildUpdatePlan(block, input.projectPath);

        return {
            status: "success",
            patch
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
