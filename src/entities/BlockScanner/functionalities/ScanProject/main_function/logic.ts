import { z } from "zod";
import { DATA as KloksStoreData, FUNCTIONS as KloksStoreFuncs } from "../../../../../libraries/KloksStoreConcepts/KloksStoreConcepts.js";
import { DATA as ScannerData, FUNCTIONS as ScannerFuncs } from "../../../../../libraries/ScannerConcepts/ScannerConcepts.js";

/**
 * Define the input/output contract for this functionality.
 */
export const schema = {
    input: z.object({
        projectPath: z.string()
    }),
    output: z.object({
        status: z.string(),
        message: z.string().optional(),
        libraries: z.array(z.any()).optional(),
        entities: z.array(z.any()).optional(),
        functionalities: z.array(z.any()).optional()
    })
};

export const main = async (input: any, { state, emitters, functionality, caller }: any) => {
    try {
        const result = ScannerFuncs.walkKrnlProject(input.projectPath);
        return {
            status: "success",
            ...result
        };
    } catch (error: any) {
        return {
            status: "error",
            message: error.message
        };
    }
};
