// src/libraries/KloksStoreConcepts/KloksStoreConcepts.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
var cachedDb = null;
var DATA = {
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
    { id: "dev-tools", name: "Developer Tools", description: "Tools for aid in development workflows" },
    { id: "auth", name: "Authentication", description: "Authentication and authorization blocks" },
    { id: "storage", name: "Storage", description: "Database and filesystem adapters" },
    { id: "docs", name: "Documentation", description: "Systems for documentation and self-docs" },
    { id: "networking", name: "Networking", description: "HTTP, WS, TCP and P2P networking utilities" },
    { id: "testing", name: "Testing", description: "Unit testing and verification helper suites" },
    { id: "ai-integration", name: "AI Integration", description: "LLM agents and LLM APIs" },
    { id: "utilities", name: "Utilities", description: "Standard algorithms and data formatting" }
  ]
};
var FUNCTIONS = {
  getDefaultDbPath() {
    if (process.env.KLOKS_DB_PATH) {
      return process.env.KLOKS_DB_PATH;
    }
    return path.join(os.homedir(), ".kloks", "kloks.db");
  },
  getDb() {
    if (cachedDb) return cachedDb;
    const dbPath = FUNCTIONS.getDefaultDbPath();
    cachedDb = FUNCTIONS.initDb(dbPath);
    return cachedDb;
  },
  initDb(dbPath) {
    if (cachedDb) return cachedDb;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    db.exec(DATA.BlockRecordSchema);
    db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
                name, description, tags, category,
                content='blocks', content_rowid='rowid'
            );
        `);
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
  upsertBlock(db, block) {
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
      description: block.description || "",
      version: block.version,
      tags: JSON.stringify(block.tags || []),
      dependencies: JSON.stringify(block.dependencies || { npm: [], kloksBlocks: [] }),
      files: JSON.stringify(block.files || {}),
      fingerprint: JSON.stringify(block.fingerprint || { contentHash: "" }),
      metadata: JSON.stringify(block.metadata || {}),
      changelog: JSON.stringify(block.changelog || [])
    });
  },
  getBlockById(db, id) {
    const row = db.prepare("SELECT * FROM blocks WHERE id = ?").get(id);
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
  deleteBlock(db, id) {
    db.prepare("DELETE FROM block_usage WHERE blockId = ?").run(id);
    const result = db.prepare("DELETE FROM blocks WHERE id = ?").run(id);
    return result.changes > 0;
  },
  listBlocks(db, filter = {}) {
    let query = "SELECT * FROM blocks";
    const conditions = [];
    const params = [];
    if (filter.blockType) {
      conditions.push("blockType = ?");
      params.push(filter.blockType);
    }
    if (filter.category) {
      conditions.push("category = ?");
      params.push(filter.category);
    }
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY id ASC";
    const rows = db.prepare(query).all(...params);
    let results = rows.map((row) => ({
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
    if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
      results = results.filter(
        (block) => filter.tags.every((t) => block.tags.includes(t))
      );
    }
    if (filter.page && filter.pageSize) {
      const start = (filter.page - 1) * filter.pageSize;
      results = results.slice(start, start + filter.pageSize);
    }
    return results;
  },
  searchBlocksFts(db, textQuery) {
    const rows = db.prepare(`
            SELECT b.* FROM blocks b
            JOIN blocks_fts fts ON fts.rowid = b.rowid
            WHERE blocks_fts MATCH ?
        `).all(textQuery);
    return rows.map((row) => ({
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
  recordUsage(db, blockId, projectPath, version) {
    const id = `${blockId}:${projectPath}`;
    const stmt = db.prepare(`
            INSERT INTO block_usage (id, blockId, projectPath, detectedAt, blockVersion)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                detectedAt=excluded.detectedAt,
                blockVersion=excluded.blockVersion
        `);
    stmt.run(id, blockId, projectPath, (/* @__PURE__ */ new Date()).toISOString(), version);
  },
  getUsageByBlock(db, blockId) {
    return db.prepare("SELECT * FROM block_usage WHERE blockId = ?").all(blockId);
  },
  upsertCategory(db, category) {
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
      description: category.description || ""
    });
  },
  listCategories(db) {
    return db.prepare("SELECT * FROM categories ORDER BY name ASC").all();
  }
};
export {
  DATA,
  FUNCTIONS
};
