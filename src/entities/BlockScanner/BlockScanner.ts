import { GetProjectBlockReportAtom } from "./functionalities/GetProjectBlockReport/GetProjectBlockReport.ts";
import { CheckBlockPresenceAtom } from "./functionalities/CheckBlockPresence/CheckBlockPresence.ts";
import { ScanProjectAtom } from "./functionalities/ScanProject/ScanProject.ts";
import { krnlEntityBase } from "krnlts";
import { z } from "zod";

export class BlockScanner extends krnlEntityBase {
    constructor(owner: krnlEntityBase | null) {
        super("BlockScanner", owner);
        this.addLocal(ScanProjectAtom);
        this.addLocal(CheckBlockPresenceAtom);
        this.addLocal(GetProjectBlockReportAtom);
        // Scaffolding: addLocal(FuncAtom), addChild(ChildEntity)
    }
}
