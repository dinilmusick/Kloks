import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as UpdateManagerData, FUNCTIONS as UpdateManagerFuncs } from "../../../../../libraries/UpdateManagerConcepts/UpdateManagerConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        bumpType: z.enum(["patch", "minor", "major"]),
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

        const nextVersion = UpdateManagerFuncs.bumpSemver(block.version, input.bumpType);
        
        // Add current version to changelog
        const historyEntry = {
            version: block.version,
            timestamp: new Date().toISOString(),
            description: input.changelogMessage || `Bumped ${input.bumpType} version to ${nextVersion}`
        };
        const changelog = [...(block.changelog || []), historyEntry];

        const updatedBlock = {
            ...block,
            version: nextVersion,
            changelog
        };

        KloksStoreFuncs.upsertBlock(db, updatedBlock);

        return {
            status: "success",
            message: `Block '${block.name}' bumped to ${nextVersion}`,
            block: updatedBlock
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
