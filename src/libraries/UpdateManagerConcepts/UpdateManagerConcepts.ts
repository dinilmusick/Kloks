import crypto from 'crypto';

/////////// DATA SECTION ///////////
export const DATA = {
};

/////////// FUNCTIONS SECTION ///////////
export const FUNCTIONS = {
    computeContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    },

    bumpSemver(version: string, type: 'patch' | 'minor' | 'major'): string {
        const parts = version.split('.').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) {
            return '1.0.0';
        }

        let [major, minor, patch] = parts;
        if (type === 'major') {
            major++;
            minor = 0;
            patch = 0;
        } else if (type === 'minor') {
            minor++;
            patch = 0;
        } else {
            patch++;
        }

        return `${major}.${minor}.${patch}`;
    },

    diffFiles(oldContent: string, newContent: string): string {
        if (oldContent === newContent) return '';
        
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const diff: string[] = [];

        // Basic line-by-line diff implementation
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

        return diff.join('\n');
    },

    buildUpdatePlan(block: any, targetProjectPath: string): any {
        const filesToWrite: Array<{ path: string, content: string }> = [];
        const filesToDelete: string[] = [];
        const postApplySteps: string[] = [];

        // Determine destination folders based on block type
        let baseDir = '';
        if (block.blockType === 'concept') {
            baseDir = `src/libraries/${block.name}Concepts`;
            postApplySteps.push(`AddLibrary concept import for ${block.name}Concepts to files requiring it.`);
        } else if (block.blockType === 'functionality') {
            // Functionalities must reside inside an entity directory, default to src/entities/Common for scaffold purposes
            baseDir = `src/entities/Common/functionalities/${block.name}`;
            postApplySteps.push(`Wire functionality ${block.name} into target entity assembler.`);
        } else if (block.blockType === 'entity') {
            baseDir = `src/entities/${block.name}`;
            postApplySteps.push(`Register entity child ${block.name} inside system assembler.`);
        }

        // Add files to plan
        for (const [relPath, content] of Object.entries(block.files || {})) {
            const destPath = `${baseDir}/${relPath}`;
            filesToWrite.push({
                path: destPath,
                content: content as string
            });
        }

        // Add NPM packages to install steps
        const npmDeps = block.dependencies?.npm || [];
        if (npmDeps.length > 0) {
            postApplySteps.push(`Install required npm packages: npm install ${npmDeps.join(' ')}`);
        }

        // Add dependent blocks
        const kloksDeps = block.dependencies?.kloksBlocks || [];
        if (kloksDeps.length > 0) {
            postApplySteps.push(`Ensure dependencies are installed first: ${kloksDeps.join(', ')}`);
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
