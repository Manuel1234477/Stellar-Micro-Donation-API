'use strict';

/**
 * Tests for donation tags.
 *
 * Extracted from the legacy issue-numbered bundle `tests/issues-65-66-67-68.test.js`
 * (issue #65) and renamed to follow the module-based naming convention
 * described in docs/TEST_NAMING_CONVENTION.md.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createTagsService } = require('../../src/constants/tags');

describe('donation tags (#65)', () => {
  let tagsService;

  beforeEach(() => {
    tagsService = createTagsService();
  });

  it('exposes the default set of donation tags', () => {
    const tags = tagsService.listTags();
    assert.ok(Array.isArray(tags));
    assert.ok(tags.length > 0);
  });

  it('returns tags with a name and a label', () => {
    const tags = tagsService.listTags();
    for (const tag of tags) {
      assert.equal(typeof tag.name, 'string');
      assert.ok(tag.name.length > 0);
      assert.equal(typeof tag.label, 'string');
      assert.ok(tag.label.length > 0);
    }
  });

  it('normalises tag names to lowercase', () => {
    const tag = tagsService.addTag('Education');
    assert.equal(tag.name, 'education');
  });

  it('trims whitespace from tag names', () => {
    const tag = tagsService.addTag('  health  ');
    assert.equal(tag.name, 'health');
  });

  it('rejects empty tag names', () => {
    assert.throws(() => tagsService.addTag(''), /tag name/i);
    assert.throws(() => tagsService.addTag('   '), /tag name/i);
  });

  it('rejects non-string tag names', () => {
    assert.throws(() => tagsService.addTag(null), /tag name/i);
    assert.throws(() => tagsService.addTag(42), /tag name/i);
  });

  it('does not add duplicate tags', () => {
    const first = tagsService.addTag('environment');
    const before = tagsService.listTags().length;
    const second = tagsService.addTag('Environment');
    const after = tagsService.listTags().length;

    assert.equal(first.name, second.name);
    assert.equal(before, after);
  });

  it('finds a tag by name case-insensitively', () => {
    tagsService.addTag('disaster-relief');
    const found = tagsService.findTag('DISASTER-RELIEF');
    assert.ok(found);
    assert.equal(found.name, 'disaster-relief');
  });

  it('returns undefined when a tag is not found', () => {
    assert.equal(tagsService.findTag('does-not-exist'), undefined);
  });

  it('removes an existing tag', () => {
    tagsService.addTag('temporary');
    assert.ok(tagsService.findTag('temporary'));

    const removed = tagsService.removeTag('temporary');
    assert.equal(removed, true);
    assert.equal(tagsService.findTag('temporary'), undefined);
  });

  it('returns false when removing a missing tag', () => {
    assert.equal(tagsService.removeTag('missing'), false);
  });

  it('validates a list of tags and reports unknown ones', () => {
    tagsService.addTag('education');
    const result = tagsService.validateTags(['education', 'unknown-tag']);

    assert.equal(result.valid, false);
    assert.deepEqual(result.unknown, ['unknown-tag']);
  });

  it('accepts a list containing only known tags', () => {
    tagsService.addTag('education');
    tagsService.addTag('health');
    const result = tagsService.validateTags(['education', 'Health']);

    assert.equal(result.valid, true);
    assert.deepEqual(result.unknown, []);
  });

  it('rejects a non-array when validating tags', () => {
    assert.throws(() => tagsService.validateTags('education'), /array/i);
  });
});