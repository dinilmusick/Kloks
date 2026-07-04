import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        id: z.string(),
        category: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        dependencies: z.object({
            npm: z.array(z.string()).optional(),
            kloksBlocks: z.array(z.string()).optional()
        }).optional(),
        metadata: z.record(z.any()).optional()
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

        const updatedBlock = {
            ...block,
            category: input.category !== undefined ? input.category : block.category,
            description: input.description !== undefined ? input.description : block.description,
            tags: input.tags !== undefined ? input.tags : block.tags,
            dependencies: input.dependencies !== undefined ? input.dependencies : block.dependencies,
            metadata: input.metadata !== undefined ? input.metadata : block.metadata
        };

        KloksStoreFuncs.upsertBlock(db, updatedBlock);

        return {
            status: "success",
            message: `Block '${block.name}' metadata updated successfully`,
            block: updatedBlock
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
