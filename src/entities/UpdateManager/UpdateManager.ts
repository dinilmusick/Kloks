import { GenerateUpdatePatchAtom } from "./functionalities/GenerateUpdatePatch/GenerateUpdatePatch.ts";
import { GetUpdateableProjectsAtom } from "./functionalities/GetUpdateableProjects/GetUpdateableProjects.ts";
import { FindBlockUsagesAtom } from "./functionalities/FindBlockUsages/FindBlockUsages.ts";
import { GetBlockDiffAtom } from "./functionalities/GetBlockDiff/GetBlockDiff.ts";
import { BumpBlockVersionAtom } from "./functionalities/BumpBlockVersion/BumpBlockVersion.ts";
import { krnlEntityBase } from "krnlts";
import { z } from "zod";

export class UpdateManager extends krnlEntityBase {
    constructor(owner: krnlEntityBase | null) {
        super("UpdateManager", owner);
        this.addLocal(BumpBlockVersionAtom);
        this.addLocal(GetBlockDiffAtom);
        this.addLocal(FindBlockUsagesAtom);
        this.addLocal(GetUpdateableProjectsAtom);
        this.addLocal(GenerateUpdatePatchAtom);
        // Scaffolding: addLocal(FuncAtom), addChild(ChildEntity)
    }
}
