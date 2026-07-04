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
        updateable: z.array(z.any()).optional()
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

        const usages = KloksStoreFuncs.getUsageByBlock(db, input.blockId);
        const updateable = usages
            .filter(usage => usage.blockVersion !== block.version)
            .map(usage => ({
                projectPath: usage.projectPath,
                currentVersion: usage.blockVersion,
                latestVersion: block.version
            }));

        return {
            status: "success",
            updateable
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
