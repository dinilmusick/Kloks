// src/libraries/SearchEngineConcepts/SearchEngineConcepts.ts
import Fuse from "fuse.js";
var DATA = {};
var FUNCTIONS = {
  buildFuseIndex(blocks) {
    return new Fuse(blocks, {
      keys: [
        { name: "name", weight: 0.5 },
        { name: "description", weight: 0.3 },
        { name: "tags", weight: 0.2 }
      ],
      threshold: 0.4,
      includeScore: true
    });
  },
  parseQueryString(raw) {
    const result = {
      blockType: null,
      category: null,
      tags: [],
      searchTerm: ""
    };
    const tokens = raw.split(/\s+/);
    const searchWords = [];
    for (const token of tokens) {
      if (token.startsWith("type:")) {
        result.blockType = token.slice(5);
      } else if (token.startsWith("category:")) {
        result.category = token.slice(9);
      } else if (token.startsWith("tag:")) {
        result.tags.push(token.slice(4));
      } else if (token.trim() !== "") {
        searchWords.push(token);
      }
    }
    result.searchTerm = searchWords.join(" ");
    return result;
  },
  rankResults(ftsResults, fuseResults) {
    const blockMap = /* @__PURE__ */ new Map();
    for (const block of ftsResults) {
      blockMap.set(block.id, {
        block,
        score: 1,
        matchedOn: "fts"
      });
    }
    for (const entry of fuseResults) {
      const block = entry.item;
      const fuzzyScore = 1 - (entry.score || 0);
      const existing = blockMap.get(block.id);
      if (existing) {
        existing.score = Math.max(existing.score, fuzzyScore) * 1.2;
        existing.matchedOn = "hybrid";
      } else {
        blockMap.set(block.id, {
          block,
          score: fuzzyScore,
          matchedOn: "fuzzy"
        });
      }
    }
    return Array.from(blockMap.values()).sort((a, b) => b.score - a.score).map((item) => ({
      ...item.block,
      _score: item.score,
      _matchedOn: item.matchedOn
    }));
  }
};
export {
  DATA,
  FUNCTIONS
};
