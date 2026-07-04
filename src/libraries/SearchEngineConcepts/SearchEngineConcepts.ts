import Fuse from 'fuse.js';

/////////// DATA SECTION ///////////
export const DATA = {
};

/////////// FUNCTIONS SECTION ///////////
export const FUNCTIONS = {
    buildFuseIndex(blocks: any[]): Fuse<any> {
        return new Fuse(blocks, {
            keys: [
                { name: 'name', weight: 0.5 },
                { name: 'description', weight: 0.3 },
                { name: 'tags', weight: 0.2 }
            ],
            threshold: 0.4,
            includeScore: true
        });
    },

    parseQueryString(raw: string): any {
        const result = {
            blockType: null as string | null,
            category: null as string | null,
            tags: [] as string[],
            searchTerm: ''
        };

        const tokens = raw.split(/\s+/);
        const searchWords: string[] = [];

        for (const token of tokens) {
            if (token.startsWith('type:')) {
                result.blockType = token.slice(5);
            } else if (token.startsWith('category:')) {
                result.category = token.slice(9);
            } else if (token.startsWith('tag:')) {
                result.tags.push(token.slice(4));
            } else if (token.trim() !== '') {
                searchWords.push(token);
            }
        }

        result.searchTerm = searchWords.join(' ');
        return result;
    },

    rankResults(ftsResults: any[], fuseResults: any[]): any[] {
        // Merge FTS5 results and Fuse.js fuzzy results
        // FTS matches are highly precise, so they get high rank (score = 1.0)
        // Fuse matches are ranked by distance (1 - score)
        const blockMap = new Map<string, { block: any, score: number, matchedOn: string }>();

        // 1. Add FTS5 results
        for (const block of ftsResults) {
            blockMap.set(block.id, {
                block,
                score: 1.0,
                matchedOn: 'fts'
            });
        }

        // 2. Add Fuse.js results
        for (const entry of fuseResults) {
            const block = entry.item;
            const fuzzyScore = 1 - (entry.score || 0); // invert so higher is better (0 is perfect match in fuse)
            const existing = blockMap.get(block.id);
            if (existing) {
                // Boost score if found in both
                existing.score = Math.max(existing.score, fuzzyScore) * 1.2;
                existing.matchedOn = 'hybrid';
            } else {
                blockMap.set(block.id, {
                    block,
                    score: fuzzyScore,
                    matchedOn: 'fuzzy'
                });
            }
        }

        // Convert map to sorted array
        return Array.from(blockMap.values())
            .sort((a, b) => b.score - a.score)
            .map(item => ({
                ...item.block,
                _score: item.score,
                _matchedOn: item.matchedOn
            }));
    }
};
