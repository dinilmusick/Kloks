import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        version: z.string(),
        files: z.record(z.string()),
        changelogMessage: z.string().optional()
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

        // Add history/changelog entry
        const historyEntry = {
            version: block.version,
            timestamp: new Date().toISOString(),
            description: input.changelogMessage || `Files updated to version ${input.version}`
        };
        const changelog = [...(block.changelog || []), historyEntry];

        const updatedBlock = {
            ...block,
            version: input.version,
            files: input.files,
            changelog
        };

        KloksStoreFuncs.upsertBlock(db, updatedBlock);

        return {
            status: "success",
            message: `Block '${block.name}' updated to version ${input.version} successfully`,
            block: updatedBlock
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
