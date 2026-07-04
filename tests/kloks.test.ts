import { FUNCTIONS as KloksStore } from '../src/libraries/KloksStoreConcepts/KloksStoreConcepts';
import { main as saveBlock } from '../src/entities/BlockRegistry/functionalities/SaveBlock/main_function/logic';
import { main as getBlock } from '../src/entities/BlockRegistry/functionalities/GetBlock/main_function/logic';
import { main as listBlocks } from '../src/entities/BlockRegistry/functionalities/ListBlocks/main_function/logic';
import { main as getInstallPlan } from '../src/entities/BlockRegistry/functionalities/GetBlockInstallPlan/main_function/logic';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDbPath = path.join(__dirname, 'test.db');

describe('Kloks Core Store & Registry Tests', () => {
    beforeAll(() => {
        // Clean up test DB if it exists
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        // Force the singleton initialization to use the test DB
        process.env.KLOKS_DB_PATH = testDbPath;
    });

    afterAll(() => {
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    test('should initialize DB with schemas and default categories', () => {
        const db = KloksStore.getDb();
        expect(db).toBeDefined();

        const categories = KloksStore.listCategories(db);
        expect(categories.length).toBeGreaterThan(0);
        expect(categories.some(c => c.id === 'auth')).toBe(true);
    });

    test('should save and retrieve a block using SaveBlock and GetBlock', async () => {
        const testBlock = {
            id: 'concept:testconcepts',
            name: 'TestConcepts',
            blockType: 'concept' as const,
            category: 'utilities',
            description: 'A test concept block',
            version: '1.0.0',
            tags: ['test', 'core'],
            dependencies: {
                npm: ['lodash'],
                kloksBlocks: []
            },
            files: {
                'index.ts': 'export const hello = "world";'
            }
        };

        const saveRes = await saveBlock(testBlock, {});
        expect(saveRes.status).toBe('success');

        const getRes = await getBlock({ id: 'concept:testconcepts' }, {});
        expect(getRes.status).toBe('success');
        expect(getRes.block.name).toBe('TestConcepts');
        expect(getRes.block.version).toBe('1.0.0');
        expect(getRes.block.tags).toContain('test');
    });

    test('should list blocks by filter', async () => {
        const listRes = await listBlocks({ blockType: 'concept' }, {});
        expect(listRes.status).toBe('success');
        expect(listRes.blocks?.length).toBeGreaterThan(0);
    });

    test('should construct a valid install plan and detect circular dependencies', async () => {
        // Save block A which depends on block B
        await saveBlock({
            id: 'concept:blocka',
            name: 'BlockA',
            blockType: 'concept' as const,
            version: '1.0.0',
            dependencies: {
                kloksBlocks: ['concept:blockb']
            }
        }, {});

        // Save block B
        await saveBlock({
            id: 'concept:blockb',
            name: 'BlockB',
            blockType: 'concept' as const,
            version: '1.0.0',
            dependencies: {
                kloksBlocks: []
            }
        }, {});

        const planRes = await getInstallPlan({ id: 'concept:blocka' }, {});
        expect(planRes.status).toBe('success');
        expect(planRes.installOrder).toEqual(['concept:blockb', 'concept:blocka']);

        // Now introduce a cycle: Block B depends on Block A
        await saveBlock({
            id: 'concept:blockb',
            name: 'BlockB',
            blockType: 'concept' as const,
            version: '1.0.0',
            dependencies: {
                kloksBlocks: ['concept:blocka']
            }
        }, {});

        const failPlanRes = await getInstallPlan({ id: 'concept:blocka' }, {});
        expect(failPlanRes.status).toBe('error');
        expect(failPlanRes.message).toContain('Circular dependency detected');
    });
});
