import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

let cachedDb: Database.Database | null = null;

/////////// DATA SECTION ///////////
export const DATA = {
    BlockRecordSchema: `
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS blocks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            blockType TEXT NOT NULL,
            category TEXT,
            description TEXT,
            version TEXT NOT NULL,
            tags TEXT NOT NULL,
            dependencies TEXT NOT NULL,
            files TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            metadata TEXT NOT NULL,
            changelog TEXT NOT NULL,
            FOREIGN KEY(category) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS block_usage (
            id TEXT PRIMARY KEY,
            blockId TEXT NOT NULL,
            projectPath TEXT NOT NULL,
            detectedAt TEXT NOT NULL,
            blockVersion TEXT NOT NULL,
            FOREIGN KEY(blockId) REFERENCES blocks(id)
        );
    `,
    
    DefaultCategories: [
        { id: 'dev-tools', name: 'Developer Tools', description: 'Tools for aid in development workflows' },
        { id: 'auth', name: 'Authentication', description: 'Authentication and authorization blocks' },
        { id: 'storage', name: 'Storage', description: 'Database and filesystem adapters' },
        { id: 'docs', name: 'Documentation', description: 'Systems for documentation and self-docs' },
        { id: 'networking', name: 'Networking', description: 'HTTP, WS, TCP and P2P networking utilities' },
        { id: 'testing', name: 'Testing', description: 'Unit testing and verification helper suites' },
        { id: 'ai-integration', name: 'AI Integration', description: 'LLM agents and LLM APIs' },
        { id: 'utilities', name: 'Utilities', description: 'Standard algorithms and data formatting' }
    ]
};

/////////// FUNCTIONS SECTION ///////////
export const FUNCTIONS = {
    getDefaultDbPath(): string {
        if (process.env.KLOKS_DB_PATH) {
            return process.env.KLOKS_DB_PATH;
        }
        return path.join(os.homedir(), '.kloks', 'kloks.db');
    },

    getDb(): Database.Database {
        if (cachedDb) return cachedDb;
        const dbPath = FUNCTIONS.getDefaultDbPath();
        cachedDb = FUNCTIONS.initDb(dbPath);
        return cachedDb;
    },

    initDb(dbPath: string): Database.Database {
        if (cachedDb) return cachedDb;
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const db = new Database(dbPath);
        
        // Enable foreign keys
        db.pragma('foreign_keys = ON');
        
        // Execute schema
        db.exec(DATA.BlockRecordSchema);
        
        // Setup FTS5 virtual table and triggers
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
                name, description, tags, category,
                content='blocks', content_rowid='rowid'
            );
        `);
        
        // Ensure triggers exist to sync FTS5
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
                INSERT INTO blocks_fts(rowid, name, description, tags, category)
                VALUES (new.rowid, new.name, new.description, new.tags, new.category);
            END;
            
            CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, name, description, tags, category)
                VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
            END;

            CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks BEGIN
                INSERT INTO blocks_fts(blocks_fts, rowid, name, description, tags, category)
                VALUES ('delete', old.rowid, old.name, old.description, old.tags, old.category);
                INSERT INTO blocks_fts(rowid, name, description, tags, category)
                VALUES (new.rowid, new.name, new.description, new.tags, new.category);
            END;
        `);

        // Prepopulate default categories
        const insertCategory = db.prepare(`
            INSERT OR IGNORE INTO categories (id, name, description)
            VALUES (@id, @name, @description)
        `);
        
        const transaction = db.transaction((categories) => {
            for (const cat of categories) {
                insertCategory.run(cat);
            }
        });
        
        transaction(DATA.DefaultCategories);
        
        return db;
    },

    upsertBlock(db: Database.Database, block: any): void {
        const stmt = db.prepare(`
            INSERT INTO blocks (id, name, blockType, category, description, version, tags, dependencies, files, fingerprint, metadata, changelog)
            VALUES (@id, @name, @blockType, @category, @description, @version, @tags, @dependencies, @files, @fingerprint, @metadata, @changelog)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                blockType=excluded.blockType,
                category=excluded.category,
                description=excluded.description,
                version=excluded.version,
                tags=excluded.tags,
                dependencies=excluded.dependencies,
                files=excluded.files,
                fingerprint=excluded.fingerprint,
                metadata=excluded.metadata,
                changelog=excluded.changelog
        `);
        
        stmt.run({
            id: block.id,
            name: block.name,
            blockType: block.blockType,
            category: block.category || null,
            description: block.description || '',
            version: block.version,
            tags: JSON.stringify(block.tags || []),
            dependencies: JSON.stringify(block.dependencies || { npm: [], kloksBlocks: [] }),
            files: JSON.stringify(block.files || {}),
            fingerprint: JSON.stringify(block.fingerprint || { contentHash: '' }),
            metadata: JSON.stringify(block.metadata || {}),
            changelog: JSON.stringify(block.changelog || [])
        });
    },

    getBlockById(db: Database.Database, id: string): any {
        const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id) as any;
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            blockType: row.blockType,
            category: row.category,
            description: row.description,
            version: row.version,
            tags: JSON.parse(row.tags),
            dependencies: JSON.parse(row.dependencies),
            files: JSON.parse(row.files),
            fingerprint: JSON.parse(row.fingerprint),
            metadata: JSON.parse(row.metadata),
            changelog: JSON.parse(row.changelog)
        };
    },

    deleteBlock(db: Database.Database, id: string): boolean {
        // Delete usages first due to foreign keys, or let cascades do it (we didn't define cascades, so manual deletion)
        db.prepare('DELETE FROM block_usage WHERE blockId = ?').run(id);
        const result = db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
        return result.changes > 0;
    },

    listBlocks(db: Database.Database, filter: any = {}): any[] {
        let query = 'SELECT * FROM blocks';
        const conditions: string[] = [];
        const params: any[] = [];

        if (filter.blockType) {
            conditions.push('blockType = ?');
            params.push(filter.blockType);
        }
        if (filter.category) {
            conditions.push('category = ?');
            params.push(filter.category);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY id ASC';

        const rows = db.prepare(query).all(...params) as any[];
        
        let results = rows.map(row => ({
            id: row.id,
            name: row.name,
            blockType: row.blockType,
            category: row.category,
            description: row.description,
            version: row.version,
            tags: JSON.parse(row.tags),
            dependencies: JSON.parse(row.dependencies),
            files: JSON.parse(row.files),
            fingerprint: JSON.parse(row.fingerprint),
            metadata: JSON.parse(row.metadata),
            changelog: JSON.parse(row.changelog)
        }));

        // Filter tags in JS memory for simplicity since it is stored as JSON text
        if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
            results = results.filter(block => 
                filter.tags.every((t: string) => block.tags.includes(t))
            );
        }

        // Pagination
        if (filter.page && filter.pageSize) {
            const start = (filter.page - 1) * filter.pageSize;
            results = results.slice(start, start + filter.pageSize);
        }

        return results;
    },

    searchBlocksFts(db: Database.Database, textQuery: string): any[] {
        // Simple search query matching FTS index
        const rows = db.prepare(`
            SELECT b.* FROM blocks b
            JOIN blocks_fts fts ON fts.rowid = b.rowid
            WHERE blocks_fts MATCH ?
        `).all(textQuery) as any[];

        return rows.map(row => ({
            id: row.id,
            name: row.name,
            blockType: row.blockType,
            category: row.category,
            description: row.description,
            version: row.version,
            tags: JSON.parse(row.tags),
            dependencies: JSON.parse(row.dependencies),
            files: JSON.parse(row.files),
            fingerprint: JSON.parse(row.fingerprint),
            metadata: JSON.parse(row.metadata),
            changelog: JSON.parse(row.changelog)
        }));
    },

    recordUsage(db: Database.Database, blockId: string, projectPath: string, version: string): void {
        const id = `${blockId}:${projectPath}`;
        const stmt = db.prepare(`
            INSERT INTO block_usage (id, blockId, projectPath, detectedAt, blockVersion)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                detectedAt=excluded.detectedAt,
                blockVersion=excluded.blockVersion
        `);
        stmt.run(id, blockId, projectPath, new Date().toISOString(), version);
    },

    getUsageByBlock(db: Database.Database, blockId: string): any[] {
        return db.prepare('SELECT * FROM block_usage WHERE blockId = ?').all(blockId) as any[];
    },

    upsertCategory(db: Database.Database, category: any): void {
        const stmt = db.prepare(`
            INSERT INTO categories (id, name, description)
            VALUES (@id, @name, @description)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                description=excluded.description
        `);
        stmt.run({
            id: category.id,
            name: category.name,
            description: category.description || ''
        });
    },

    listCategories(db: Database.Database): any[] {
        return db.prepare('SELECT * FROM categories ORDER BY name ASC').all() as any[];
    }
};
