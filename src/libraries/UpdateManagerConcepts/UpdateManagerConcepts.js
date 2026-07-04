// src/libraries/UpdateManagerConcepts/UpdateManagerConcepts.ts
import crypto from "crypto";
var DATA = {};
var FUNCTIONS = {
  computeContentHash(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
  },
  bumpSemver(version, type) {
    const parts = version.split(".").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      return "1.0.0";
    }
    let [major, minor, patch] = parts;
    if (type === "major") {
      major++;
      minor = 0;
      patch = 0;
    } else if (type === "minor") {
      minor++;
      patch = 0;
    } else {
      patch++;
    }
    return `${major}.${minor}.${patch}`;
  },
  diffFiles(oldContent, newContent) {
    if (oldContent === newContent) return "";
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diff = [];
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++;
        j++;
      } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]))) {
        diff.push(`+ ${newLines[j]}`);
        j++;
      } else {
        diff.push(`- ${oldLines[i]}`);
        i++;
      }
    }
    return diff.join("\n");
  },
  buildUpdatePlan(block, targetProjectPath) {
    const filesToWrite = [];
    const filesToDelete = [];
    const postApplySteps = [];
    let baseDir = "";
    if (block.blockType === "concept") {
      baseDir = `src/libraries/${block.name}Concepts`;
      postApplySteps.push(`AddLibrary concept import for ${block.name}Concepts to files requiring it.`);
    } else if (block.blockType === "functionality") {
      baseDir = `src/entities/Common/functionalities/${block.name}`;
      postApplySteps.push(`Wire functionality ${block.name} into target entity assembler.`);
    } else if (block.blockType === "entity") {
      baseDir = `src/entities/${block.name}`;
      postApplySteps.push(`Register entity child ${block.name} inside system assembler.`);
    }
    for (const [relPath, content] of Object.entries(block.files || {})) {
      const destPath = `${baseDir}/${relPath}`;
      filesToWrite.push({
        path: destPath,
        content
      });
    }
    const npmDeps = block.dependencies?.npm || [];
    if (npmDeps.length > 0) {
      postApplySteps.push(`Install required npm packages: npm install ${npmDeps.join(" ")}`);
    }
    const kloksDeps = block.dependencies?.kloksBlocks || [];
    if (kloksDeps.length > 0) {
      postApplySteps.push(`Ensure dependencies are installed first: ${kloksDeps.join(", ")}`);
    }
    return {
      blockId: block.id,
      targetPath: targetProjectPath,
      filesToWrite,
      filesToDelete,
      postApplySteps
    };
  }
};
export {
  DATA,
  FUNCTIONS
};
