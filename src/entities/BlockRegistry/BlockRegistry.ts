import { ExtractBlockFromProjectAtom } from "./functionalities/ExtractBlockFromProject/ExtractBlockFromProject.ts";
import { GetBlockInstallPlanAtom } from "./functionalities/GetBlockInstallPlan/GetBlockInstallPlan.ts";
import { GetBlockChangelogAtom } from "./functionalities/GetBlockChangelog/GetBlockChangelog.ts";
import { DeleteBlockAtom } from "./functionalities/DeleteBlock/DeleteBlock.ts";
import { UpdateBlockMetadataAtom } from "./functionalities/UpdateBlockMetadata/UpdateBlockMetadata.ts";
import { UpdateBlockFilesAtom } from "./functionalities/UpdateBlockFiles/UpdateBlockFiles.ts";
import { ListBlocksAtom } from "./functionalities/ListBlocks/ListBlocks.ts";
import { GetBlockAtom } from "./functionalities/GetBlock/GetBlock.ts";
import { SaveBlockAtom } from "./functionalities/SaveBlock/SaveBlock.ts";
import { krnlEntityBase } from "krnlts";
import { z } from "zod";

export class BlockRegistry extends krnlEntityBase {
    constructor(owner: krnlEntityBase | null) {
        super("BlockRegistry", owner);
        this.addLocal(SaveBlockAtom);
        this.addLocal(GetBlockAtom);
        this.addLocal(ListBlocksAtom);
        this.addLocal(UpdateBlockFilesAtom);
        this.addLocal(UpdateBlockMetadataAtom);
        this.addLocal(DeleteBlockAtom);
        this.addLocal(GetBlockChangelogAtom);
        this.addLocal(GetBlockInstallPlanAtom);
        this.addLocal(ExtractBlockFromProjectAtom);
        // Scaffolding: addLocal(FuncAtom), addChild(ChildEntity)
    }
}
