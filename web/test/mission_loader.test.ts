import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMissionDoc } from '../src/mission/load';

const EXPECTED_CENSUS: Record<string, {
  Entity: number;
  Human: number;
  Link: number;
  Tags: number;
  Inventory: number;
  Brain: number;
}> = {
  '01_usa-overlord': { Entity: 206, Human: 414, Link: 161, Tags: 309, Inventory: 426, Brain: 342 },
  '02_usa-carentan': { Entity: 206, Human: 381, Link: 161, Tags: 360, Inventory: 393, Brain: 313 },
  '03_usa-ardennes': { Entity: 573, Human: 392, Link: 161, Tags: 295, Inventory: 404, Brain: 309 },
  '01_ger-caen': { Entity: 209, Human: 392, Link: 166, Tags: 286, Inventory: 405, Brain: 336 },
  '02_ger-sthilaire': { Entity: 208, Human: 396, Link: 166, Tags: 376, Inventory: 409, Brain: 342 },
  '03_ger-marketgarden': { Entity: 214, Human: 420, Link: 166, Tags: 311, Inventory: 429, Brain: 385 },
  '01_eng-battleaxe': { Entity: 211, Human: 460, Link: 175, Tags: 306, Inventory: 468, Brain: 425 },
  '02_eng-torch': { Entity: 212, Human: 427, Link: 177, Tags: 299, Inventory: 435, Brain: 396 },
  '03_eng-arnhem': { Entity: 211, Human: 431, Link: 175, Tags: 318, Inventory: 439, Brain: 393 },
  '01_rus-smolensk': { Entity: 205, Human: 451, Link: 158, Tags: 351, Inventory: 458, Brain: 336 },
  '02_rus-koenigsberg': { Entity: 225, Human: 476, Link: 178, Tags: 469, Inventory: 483, Brain: 358 },
  '03_rus-manchuria': { Entity: 205, Human: 454, Link: 149, Tags: 334, Inventory: 458, Brain: 345 },
  '01_jap-khalkhingol': { Entity: 211, Human: 437, Link: 177, Tags: 310, Inventory: 441, Brain: 355 },
  '02_jap-singapore': { Entity: 211, Human: 423, Link: 177, Tags: 295, Inventory: 427, Brain: 338 },
  '03_jap-iwojima': { Entity: 211, Human: 453, Link: 185, Tags: 284, Inventory: 465, Brain: 356 },
};

describe('MissionDoc Loader (T04 Acceptance)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');

  for (const [missionName, expected] of Object.entries(EXPECTED_CENSUS)) {
    it(`should parse ${missionName} matching mission_census.txt exactly`, () => {
      const filePath = path.join(fixturesDir, `${missionName}.json`);
      expect(fs.existsSync(filePath), `Fixture exists: ${filePath}`).toBe(true);

      const rawJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const doc = parseMissionDoc(rawJson, missionName);

      // Verify exact entity and human counts
      expect(doc.entities.length).toBe(expected.Entity);
      expect(doc.humans.length).toBe(expected.Human);
      expect(doc.links.length).toBe(expected.Link);
      expect(doc.tags.length).toBe(expected.Tags);
      expect(doc.inventories.length).toBe(expected.Inventory);
      expect(doc.brains.length).toBe(expected.Brain);

      // Verify helpers structure
      expect(doc.helpers.events.length).toBeGreaterThan(50);
      expect(doc.helpers.zones.length).toBeGreaterThan(15);
      expect(doc.helpers.tasks.length).toBeGreaterThan(0);
      expect(doc.helpers.reinforcements.items.length).toBeGreaterThan(0);
      expect(doc.helpers.triggers.length).toBeGreaterThan(0);

      // Verify environment and players
      expect(doc.environment).toBeTruthy();
      expect(doc.players.length).toBeGreaterThan(0);

      // Verify all entity and human IDs are valid numbers and hex strings
      for (const e of doc.entities) {
        expect(Number.isFinite(e.id)).toBe(true);
        expect(e.idHex.startsWith('0x')).toBe(true);
        expect(e.proto.length).toBeGreaterThan(0);
      }
      for (const h of doc.humans) {
        expect(Number.isFinite(h.id)).toBe(true);
        expect(h.idHex.startsWith('0x')).toBe(true);
        expect(h.proto.length).toBeGreaterThan(0);
      }
    });
  }
});
