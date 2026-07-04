// src/libraries/ScannerConcepts/ScannerConcepts.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
var DATA = {};
var FUNCTIONS = {
  walkKrnlProject(projectPath) {
    const result = {
      libraries: [],
      functionalities: [],
      entities: []
    };
    const libDir = path.join(projectPath, "src/libraries");
    if (fs.existsSync(libDir)) {
      const dirs = fs.readdirSync(libDir).filter((f) => fs.statSync(path.join(libDir, f)).isDirectory());
      for (const dir of dirs) {
        result.libraries.push({
          name: dir,
          path: path.join(libDir, dir)
        });
      }
    }
    const entDir = path.join(projectPath, "src/entities");
    if (fs.existsSync(entDir)) {
      const dirs = fs.readdirSync(entDir).filter((f) => fs.statSync(path.join(entDir, f)).isDirectory());
      for (const dir of dirs) {
        const entityPath = path.join(entDir, dir);
        result.entities.push({
          name: dir,
          path: entityPath
        });
        const funcDir = path.join(entityPath, "functionalities");
        if (fs.existsSync(funcDir)) {
          const funcs = fs.readdirSync(funcDir).filter((f) => fs.statSync(path.join(funcDir, f)).isDirectory());
          for (const func of funcs) {
            result.functionalities.push({
              name: func,
              entityName: dir,
              path: path.join(funcDir, func)
            });
          }
        }
      }
    }
    const rootFuncDir = path.join(projectPath, "src/functionalities");
    if (fs.existsSync(rootFuncDir)) {
      const funcs = fs.readdirSync(rootFuncDir).filter((f) => fs.statSync(path.join(rootFuncDir, f)).isDirectory());
      for (const func of funcs) {
        result.functionalities.push({
          name: func,
          entityName: null,
          path: path.join(rootFuncDir, func)
        });
      }
    }
    return result;
  },
  fingerprintConceptFile(filePath) {
    if (!fs.existsSync(filePath)) return { contentHash: "", symbolKeys: [] };
    const content = fs.readFileSync(filePath, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const symbolKeys = [];
    const dataMatch = content.match(/export\s+const\s+DATA\s*=\s*\{([\s\S]*?)\};/);
    if (dataMatch) {
      const dataContent = dataMatch[1];
      const keys = dataContent.match(/^\s*([a-zA-Z0-9_$]+)\s*:/gm);
      if (keys) {
        symbolKeys.push(...keys.map((k) => k.trim().replace(":", "")));
      }
    }
    const funcMatch = content.match(/export\s+const\s+FUNCTIONS\s*=\s*\{([\s\S]*?)\};/);
    if (funcMatch) {
      const funcContent = funcMatch[1];
      const keys = funcContent.match(/^\s*([a-zA-Z0-9_$]+)\s*:/gm);
      if (keys) {
        symbolKeys.push(...keys.map((k) => k.trim().replace(":", "")));
      }
    }
    return {
      contentHash: hash,
      symbolKeys: symbolKeys.sort()
    };
  },
  fingerprintFunctionalityFolder(funcPath) {
    const logicFile = path.join(funcPath, "main_function/logic.ts");
    const draftFile = path.join(funcPath, "main_function/logic.draft.ts");
    const fileToUse = fs.existsSync(logicFile) ? logicFile : fs.existsSync(draftFile) ? draftFile : null;
    if (!fileToUse) return { contentHash: "", helperNames: [] };
    const content = fs.readFileSync(fileToUse, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const helperNames = [];
    const helperDir = path.join(funcPath, "helper_functions");
    if (fs.existsSync(helperDir)) {
      const files = fs.readdirSync(helperDir).filter((f) => f.endsWith(".ts"));
      helperNames.push(...files.map((f) => path.basename(f, ".ts")));
    }
    return {
      contentHash: hash,
      helperNames: helperNames.sort()
    };
  },
  fingerprintEntityFolder(entityPath) {
    const entityName = path.basename(entityPath);
    const classFile = path.join(entityPath, `${entityName}.ts`);
    if (!fs.existsSync(classFile)) return { contentHash: "", functionalityIds: [] };
    const content = fs.readFileSync(classFile, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const functionalityIds = [];
    const matches = content.matchAll(/addLocal\(\s*([a-zA-Z0-9_$]+)Atom\s*\)/g);
    for (const match of matches) {
      functionalityIds.push(match[1]);
    }
    return {
      contentHash: hash,
      functionalityIds: functionalityIds.sort()
    };
  },
  scoreMatch(liveFingerprint, storedFingerprint) {
    if (!storedFingerprint) return 0;
    if (liveFingerprint.contentHash === storedFingerprint.contentHash && liveFingerprint.contentHash !== "") {
      return 1;
    }
    let score = 0;
    let elements = 0;
    if (storedFingerprint.symbolKeys && liveFingerprint.symbolKeys) {
      elements++;
      const storedKeys = storedFingerprint.symbolKeys;
      const liveKeys = liveFingerprint.symbolKeys;
      const shared = storedKeys.filter((k) => liveKeys.includes(k));
      const matchRatio = storedKeys.length > 0 ? shared.length / storedKeys.length : 0;
      score += matchRatio;
    }
    if (storedFingerprint.helperNames && liveFingerprint.helperNames) {
      elements++;
      const storedHelpers = storedFingerprint.helperNames;
      const liveHelpers = liveFingerprint.helperNames;
      const shared = storedHelpers.filter((h) => liveHelpers.includes(h));
      const matchRatio = storedHelpers.length > 0 ? shared.length / storedHelpers.length : 0;
      score += matchRatio;
    }
    if (storedFingerprint.functionalityIds && liveFingerprint.functionalityIds) {
      elements++;
      const storedFuncs = storedFingerprint.functionalityIds;
      const liveFuncs = liveFingerprint.functionalityIds;
      const shared = storedFuncs.filter((f) => liveFuncs.includes(f));
      const matchRatio = storedFuncs.length > 0 ? shared.length / storedFuncs.length : 0;
      score += matchRatio;
    }
    return elements > 0 ? score / elements : 0;
  }
};
export {
  DATA,
  FUNCTIONS
};
