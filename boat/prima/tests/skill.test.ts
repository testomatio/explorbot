import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrimaSkill } from '../src/skill.ts';

describe('PrimaSkill', () => {
  test('renders a skill with name and description frontmatter', () => {
    const skill = PrimaSkill.render();

    expect(skill.startsWith('---\nname: prima\ndescription: ')).toBe(true);
    expect(skill).toContain('# Prima');
    expect(skill).not.toContain('\\');
  });

  test('installs the skill for every agent under the scope root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prima-skill-'));

    const files = PrimaSkill.install('local', { local: root });

    expect(files).toEqual([path.join(root, '.claude/skills/prima/SKILL.md'), path.join(root, '.agents/skills/prima/SKILL.md')]);
    for (const file of files) expect(readFileSync(file, 'utf-8')).toBe(PrimaSkill.render());
  });

  test('offers a local and a global scope', () => {
    expect(PrimaSkill.scopes()).toEqual(['local', 'global']);
  });
});
