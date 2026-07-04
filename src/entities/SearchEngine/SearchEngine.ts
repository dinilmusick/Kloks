import { SuggestBlocksForNamesAtom } from "./functionalities/SuggestBlocksForNames/SuggestBlocksForNames.ts";
import { SuggestRelatedBlocksAtom } from "./functionalities/SuggestRelatedBlocks/SuggestRelatedBlocks.ts";
import { GetBlocksByTagAtom } from "./functionalities/GetBlocksByTag/GetBlocksByTag.ts";
import { GetBlocksByCategoryAtom } from "./functionalities/GetBlocksByCategory/GetBlocksByCategory.ts";
import { UpsertCategoryAtom } from "./functionalities/UpsertCategory/UpsertCategory.ts";
import { ListCategoriesAtom } from "./functionalities/ListCategories/ListCategories.ts";
import { SearchBlocksAtom } from "./functionalities/SearchBlocks/SearchBlocks.ts";
import { krnlEntityBase } from "krnlts";
import { z } from "zod";

export class SearchEngine extends krnlEntityBase {
    constructor(owner: krnlEntityBase | null) {
        super("SearchEngine", owner);
        this.addLocal(SearchBlocksAtom);
        this.addLocal(ListCategoriesAtom);
        this.addLocal(UpsertCategoryAtom);
        this.addLocal(GetBlocksByCategoryAtom);
        this.addLocal(GetBlocksByTagAtom);
        this.addLocal(SuggestRelatedBlocksAtom);
        this.addLocal(SuggestBlocksForNamesAtom);
        // Scaffolding: addLocal(FuncAtom), addChild(ChildEntity)
    }
}
