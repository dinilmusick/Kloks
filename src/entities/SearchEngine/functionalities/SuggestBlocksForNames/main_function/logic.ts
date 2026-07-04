import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as SearchEngineData, FUNCTIONS as SearchEngineFuncs } from "../../../../../libraries/SearchEngineConcepts/SearchEngineConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        names: z.array(z.string())
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        suggestions: z.record(z.array(z.any())).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const allBlocks = KloksStoreFuncs.listBlocks(db);
        const fuseIndex = SearchEngineFuncs.buildFuseIndex(allBlocks);

        const suggestions: Record<string, any[]> = {};

        for (const name of input.names) {
            // First look for direct exact match
            const exactMatches = allBlocks.filter(b => b.name.toLowerCase() === name.toLowerCase());
            if (exactMatches.length > 0) {
                suggestions[name] = exactMatches;
            } else {
                // Fallback to fuzzy search
                const fuzzy = fuseIndex.search(name);
                suggestions[name] = fuzzy.slice(0, 3).map(f => f.item);
            }
        }

        return {
            status: "success",
            suggestions
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
