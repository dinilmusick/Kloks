import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as UpdateManagerData, FUNCTIONS as UpdateManagerFuncs } from "../../../../../libraries/UpdateManagerConcepts/UpdateManagerConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        files: z.record(z.string())
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        diffs: z.record(z.string()).optional()
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

        const diffs: Record<string, string> = {};
        const oldFiles = block.files || {};
        const newFiles = input.files;

        // Compare old to new
        for (const [filename, oldContent] of Object.entries(oldFiles)) {
            const newContent = newFiles[filename];
            if (newContent === undefined) {
                diffs[filename] = `--- DELETED ---`;
            } else {
                const diff = UpdateManagerFuncs.diffFiles(oldContent as string, newContent as string);
                if (diff) {
                    diffs[filename] = diff;
                }
            }
        }

        // Check for newly added files
        for (const [filename, newContent] of Object.entries(newFiles)) {
            if (oldFiles[filename] === undefined) {
                diffs[filename] = `+++ ADDED +++\n${newContent}`;
            }
        }

        return {
            status: "success",
            diffs
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
