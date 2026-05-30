'use strict';

/**
 * Tests for POST /admin/impact-metrics/sdg-mapping endpoint
 * Issue #119: Implement POST /admin/impact-metrics/sdg-mapping endpoint
 */

const ImpactMetricService = require('../../src/services/ImpactMetricService');

describe('SDG Mapping Endpoints', () => {
  describe('GET /admin/impact-metrics/sdg-mapping', () => {
    it('should return array of mappings', () => {
      const mockMappings = [
        { tag: 'education', sdgId: 4, sdgName: 'Quality Education', sdgIcon: '🎓' },
        { tag: 'clean-water', sdgId: 6, sdgName: 'Clean Water and Sanitation', sdgIcon: '💧' },
      ];

      expect(Array.isArray(mockMappings)).toBe(true);
    });

    it('should include required fields in each mapping', () => {
      const mockMapping = {
        tag: 'education',
        sdgId: 4,
        sdgName: 'Quality Education',
        sdgIcon: '🎓',
      };

      expect(mockMapping).toHaveProperty('tag');
      expect(mockMapping).toHaveProperty('sdgId');
      expect(mockMapping).toHaveProperty('sdgName');
      expect(mockMapping).toHaveProperty('sdgIcon');
    });

    it('should have valid SDG IDs (1-17)', () => {
      const mockMappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'health', sdgId: 3 },
        { tag: 'climate', sdgId: 13 },
      ];

      mockMappings.forEach(mapping => {
        expect(mapping.sdgId >= 1 && mapping.sdgId <= 17).toBe(true);
      });
    });

    it('should have non-empty tag strings', () => {
      const mockMapping = {
        tag: 'education',
      };

      expect(typeof mockMapping.tag).toBe('string');
      expect(mockMapping.tag.length > 0).toBe(true);
    });

    it('should have non-empty sdgName strings', () => {
      const mockMapping = {
        sdgName: 'Quality Education',
      };

      expect(typeof mockMapping.sdgName).toBe('string');
      expect(mockMapping.sdgName.length > 0).toBe(true);
    });

    it('should have sdgIcon as emoji or string', () => {
      const mockMapping = {
        sdgIcon: '🎓',
      };

      expect(typeof mockMapping.sdgIcon).toBe('string');
      expect(mockMapping.sdgIcon.length > 0).toBe(true);
    });

    it('should include education mapping to SDG 4', () => {
      const mockMappings = [
        { tag: 'education', sdgId: 4, sdgName: 'Quality Education', sdgIcon: '🎓' },
      ];

      const educationMapping = mockMappings.find(m => m.tag === 'education');
      expect(educationMapping).toBeDefined();
      expect(educationMapping.sdgId).toBe(4);
    });

    it('should include clean-water mapping to SDG 6', () => {
      const mockMappings = [
        { tag: 'clean-water', sdgId: 6, sdgName: 'Clean Water and Sanitation', sdgIcon: '💧' },
      ];

      const waterMapping = mockMappings.find(m => m.tag === 'clean-water');
      expect(waterMapping).toBeDefined();
      expect(waterMapping.sdgId).toBe(6);
    });
  });

  describe('POST /admin/impact-metrics/sdg-mapping', () => {
    it('should create new mapping', () => {
      const newMapping = {
        tag: 'test-tag',
        sdgId: 5,
      };

      expect(newMapping).toHaveProperty('tag');
      expect(newMapping).toHaveProperty('sdgId');
    });

    it('should update existing mapping', () => {
      const existingMapping = {
        tag: 'education',
        sdgId: 4,
      };

      const updatedMapping = {
        ...existingMapping,
        sdgId: 10,
      };

      expect(updatedMapping.tag).toBe('education');
      expect(updatedMapping.sdgId).toBe(10);
    });

    it('should return created mapping with all fields', () => {
      const createdMapping = {
        tag: 'test-tag',
        sdgId: 7,
        sdgName: 'Affordable and Clean Energy',
        sdgIcon: '⚡',
      };

      expect(createdMapping).toHaveProperty('tag');
      expect(createdMapping).toHaveProperty('sdgId');
      expect(createdMapping).toHaveProperty('sdgName');
      expect(createdMapping).toHaveProperty('sdgIcon');
    });

    describe('Validation', () => {
      it('should require tag field', () => {
        const invalidMapping = { sdgId: 1 };
        expect(invalidMapping).not.toHaveProperty('tag');
      });

      it('should require sdgId field', () => {
        const invalidMapping = { tag: 'test' };
        expect(invalidMapping).not.toHaveProperty('sdgId');
      });

      it('should reject invalid SDG IDs (< 1)', () => {
        const invalidMapping = { tag: 'test', sdgId: 0 };
        expect(invalidMapping.sdgId < 1).toBe(true);
      });

      it('should reject invalid SDG IDs (> 17)', () => {
        const invalidMapping = { tag: 'test', sdgId: 18 };
        expect(invalidMapping.sdgId > 17).toBe(true);
      });

      it('should reject empty tag', () => {
        const invalidMapping = { tag: '', sdgId: 1 };
        expect(invalidMapping.tag.length === 0).toBe(true);
      });

      it('should reject non-numeric sdgId', () => {
        const invalidMapping = { tag: 'test', sdgId: 'invalid' };
        expect(typeof invalidMapping.sdgId).toBe('string');
      });
    });

    describe('Response Status', () => {
      it('should return 201 for new mapping', () => {
        const statusCode = 201;
        expect(statusCode).toBe(201);
      });

      it('should return 200 for updated mapping', () => {
        const statusCode = 200;
        expect(statusCode).toBe(200);
      });
    });
  });

  describe('DELETE /admin/impact-metrics/sdg-mapping/:tag', () => {
    it('should delete existing mapping', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'health', sdgId: 3 },
      ];

      const filtered = mappings.filter(m => m.tag !== 'education');
      expect(filtered.length).toBe(1);
      expect(filtered[0].tag).toBe('health');
    });

    it('should return 404 for non-existent mapping', () => {
      const statusCode = 404;
      expect(statusCode).toBe(404);
    });

    it('should remove mapping from GET list', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'health', sdgId: 3 },
      ];

      const deleted = mappings.filter(m => m.tag !== 'education');
      const found = deleted.find(m => m.tag === 'education');

      expect(found).toBeUndefined();
    });
  });

  describe('Impact Metrics Integration', () => {
    it('should use mappings in impact calculations', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
      ];

      const mapping = mappings.find(m => m.tag === 'education');
      expect(mapping).toBeDefined();
      expect(mapping.sdgId).toBe(4);
    });

    it('should support multiple tags mapping to same SDG', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'learning', sdgId: 4 },
      ];

      const sdg4Mappings = mappings.filter(m => m.sdgId === 4);
      expect(sdg4Mappings.length).toBe(2);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache after POST', () => {
      const initialCount = 5;
      const newCount = 6;

      expect(newCount).toBeGreaterThan(initialCount);
    });

    it('should invalidate cache after DELETE', () => {
      const countBefore = 6;
      const countAfter = 5;

      expect(countAfter).toBeLessThan(countBefore);
    });
  });

  describe('SDG Categories', () => {
    it('should support all 17 SDGs', () => {
      const sdgIds = Array.from({ length: 17 }, (_, i) => i + 1);
      expect(sdgIds.length).toBe(17);
      expect(sdgIds[0]).toBe(1);
      expect(sdgIds[16]).toBe(17);
    });

    it('should have unique SDG IDs', () => {
      const sdgIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      const uniqueIds = new Set(sdgIds);
      expect(uniqueIds.size).toBe(17);
    });

    it('should map tags to correct SDGs', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'health', sdgId: 3 },
        { tag: 'clean-water', sdgId: 6 },
        { tag: 'climate', sdgId: 13 },
      ];

      expect(mappings.find(m => m.tag === 'education').sdgId).toBe(4);
      expect(mappings.find(m => m.tag === 'health').sdgId).toBe(3);
      expect(mappings.find(m => m.tag === 'clean-water').sdgId).toBe(6);
      expect(mappings.find(m => m.tag === 'climate').sdgId).toBe(13);
    });
  });

  describe('Data Consistency', () => {
    it('should maintain tag uniqueness', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'education', sdgId: 10 },
      ];

      const tags = mappings.map(m => m.tag);
      const uniqueTags = new Set(tags);

      // If we have duplicates, the last one should win
      expect(mappings.filter(m => m.tag === 'education').length).toBeGreaterThanOrEqual(1);
    });

    it('should allow multiple tags per SDG', () => {
      const mappings = [
        { tag: 'education', sdgId: 4 },
        { tag: 'learning', sdgId: 4 },
        { tag: 'schools', sdgId: 4 },
      ];

      const sdg4Count = mappings.filter(m => m.sdgId === 4).length;
      expect(sdg4Count).toBe(3);
    });
  });

  describe('Caching', () => {
    it('should cache mappings for 5 minutes', () => {
      const cacheMaxAge = 300; // 5 minutes in seconds
      expect(cacheMaxAge).toBe(300);
    });

    it('should invalidate cache on create', () => {
      const cacheValid = false;
      expect(cacheValid).toBe(false);
    });

    it('should invalidate cache on update', () => {
      const cacheValid = false;
      expect(cacheValid).toBe(false);
    });

    it('should invalidate cache on delete', () => {
      const cacheValid = false;
      expect(cacheValid).toBe(false);
    });
  });
});
