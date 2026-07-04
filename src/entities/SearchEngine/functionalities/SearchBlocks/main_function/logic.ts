import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as SearchEngineData, FUNCTIONS as SearchEngineFuncs } from "../../../../../libraries/SearchEngineConcepts/SearchEngineConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        query: z.string(),
        blockType: z.enum(["concept", "entity", "functionality"]).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().optional().default(10)
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        results: z.array(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const parsed = SearchEngineFuncs.parseQueryString(input.query);

        // Merge explicit filters from input on top of parsed query string filters
        const filter = {
            blockType: input.blockType || parsed.blockType,
            category: input.category || parsed.category,
            tags: (input.tags || []).concat(parsed.tags)
        };

        // Fetch candidates matching structured filter
        const candidates = KloksStoreFuncs.listBlocks(db, filter);

        if (!parsed.searchTerm) {
            // Just return filtered candidates up to the limit
            return {
                status: "success",
                results: candidates.slice(0, input.limit)
            };
        }

        // Run FTS search
        const ftsResults = KloksStoreFuncs.searchBlocksFts(db, parsed.searchTerm);

        // Build Fuse index for candidates
        const fuseIndex = SearchEngineFuncs.buildFuseIndex(candidates);
        const fuseResults = fuseIndex.search(parsed.searchTerm);

        // Rank and combine
        const ranked = SearchEngineFuncs.rankResults(ftsResults, fuseResults);

        // Deduplicate and filter down by limit
        const finalResults = ranked.slice(0, input.limit);

        return {
            status: "success",
            results: finalResults
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
