import { main, schema } from "./main_function/logic.ts";
import { initialState } from "./state_data/state.ts";

export const SuggestRelatedBlocksAtom = {
    id: "SuggestRelatedBlocks",
    initialState,
    api: main,
    schema,
    visibility: "public"
};
