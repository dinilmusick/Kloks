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
        message: z.string().optional(),
        installOrder: z.array(z.string()).optional(),
        npmDependencies: z.array(z.string()).optional(),
        blocks: z.record(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const db = KloksStoreFuncs.getDb();
        const rootBlock = KloksStoreFuncs.getBlockById(db, input.id);
        if (!rootBlock) {
            return {
                status: "error",
                message: `Block with id '${input.id}' not found`
            };
        }

        const visited = new Set<string>();
        const temp = new Set<string>();
        const order: string[] = [];
        const blockMap: Record<string, any> = {};
        const npmDeps = new Set<string>();

        // Recursive DFS for topological sort with cycle detection
        const visit = (id: string) => {
            if (temp.has(id)) {
                throw new Error(`Circular dependency detected involving block '${id}'`);
            }
            if (!visited.has(id)) {
                temp.add(id);
                const block = KloksStoreFuncs.getBlockById(db, id);
                if (!block) {
                    throw new Error(`Dependency block '${id}' not found in registry`);
                }
                blockMap[id] = block;

                // Add npm dependencies
                if (block.dependencies && block.dependencies.npm) {
                    for (const dep of block.dependencies.npm) {
                        npmDeps.add(dep);
                    }
                }

                // Visit children
                const deps = block.dependencies?.kloksBlocks || [];
                for (const depId of deps) {
                    visit(depId);
                }

                temp.delete(id);
                visited.add(id);
                order.push(id);
            }
        };

        visit(input.id);

        return {
            status: "success",
            installOrder: order,
            npmDependencies: Array.from(npmDeps),
            blocks: blockMap
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
