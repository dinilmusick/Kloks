import { main as extractBlock } from './entities/BlockRegistry/functionalities/ExtractBlockFromProject/main_function/logic.js';
import path from 'path';

async function seed() {
    const projectPath = '/Users/dinil/Desktop/Projects/Javascript/DeaTS';
    
    const blocksToSeed = [
        { type: 'concept' as const, name: 'DocumentationManagerConcepts' },
        { type: 'concept' as const, name: 'CodebaseAnalyzerConcepts' },
        { type: 'concept' as const, name: 'PathResolverConcepts' },
        { type: 'functionality' as const, name: 'GetLibraryAssets' },
        { type: 'functionality' as const, name: 'CommitProject' },
        { type: 'entity' as const, name: 'KeyStore' }
    ];

    console.log('--- STARTING KLOKS LIBRARY SEEDING ---');
    for (const b of blocksToSeed) {
        console.log(`Extracting ${b.type} '${b.name}' from ${projectPath}...`);
        const res = await extractBlock({
            projectPath,
            blockType: b.type,
            name: b.name,
            version: '1.0.0'
        }, {});
        if (res.status === 'success') {
            console.log(`✅ Success: ${res.message}`);
        } else {
            console.error(`❌ Failed to extract ${b.name}: ${res.message}`);
        }
    }
    console.log('--- SEEDING COMPLETED ---');
}

seed().catch(console.error);
