import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const skillDir = path.join(repoRoot, 'skills', 'unpeek');
const skillMdPath = path.join(skillDir, 'SKILL.md');
const referencesDir = path.join(skillDir, 'references');
const openaiYamlPath = path.join(skillDir, 'agents', 'openai.yaml');

const REQUIRED_REFERENCE_FILES = [
  'quickstart.md',
  'frameworks.md',
  'architecture.md',
  'sourcemaps.md',
  'api.md',
  'recipes.md',
];

describe('unpeek Agent Skill Specification & Compliance', () => {
  it('has SKILL.md with entrypoint word count <= 500 words for token optimization', () => {
    expect(fs.existsSync(skillMdPath), 'SKILL.md should exist').toBe(true);
    const content = fs.readFileSync(skillMdPath, 'utf8');

    // Count words across full file as well as body
    const totalWords = content.trim().split(/\s+/).filter(Boolean).length;
    expect(totalWords).toBeLessThanOrEqual(500);

    // Verify metadata and Woffluon/system-design-compass standard in frontmatter
    expect(content).toMatch(/name:\s*unpeek/);
    expect(content).toMatch(/license:\s*MIT/);
    expect(content).toMatch(/author:\s*"?Woffluon"?/);
    expect(content).toMatch(/version:\s*"?1\.2\.0"?/);
  });

  it('contains all 6 required modular reference guides and none are empty', () => {
    expect(fs.existsSync(referencesDir), 'references directory should exist').toBe(true);

    for (const filename of REQUIRED_REFERENCE_FILES) {
      const filePath = path.join(referencesDir, filename);
      expect(fs.existsSync(filePath), `Reference file ${filename} should exist`).toBe(true);

      const stats = fs.statSync(filePath);
      expect(stats.size, `Reference file ${filename} should not be empty`).toBeGreaterThan(100);

      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.trim().length, `Reference file ${filename} should have content`).toBeGreaterThan(50);
    }
  });

  it('verifies all relative markdown links in SKILL.md resolve to existing files on disk', () => {
    const content = fs.readFileSync(skillMdPath, 'utf8');
    const markdownLinkRegex = /\[[^\]]+\]\(((?:\.\/)?references\/[^)#\s]+)(?:#[^)]*)?\)/g;

    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      matches.push(match[1]);
    }

    expect(matches.length, 'SKILL.md must link to reference guides').toBeGreaterThan(0);

    for (const relativePath of matches) {
      const resolvedPath = path.resolve(skillDir, relativePath);
      expect(
        fs.existsSync(resolvedPath),
        `Linked reference file '${relativePath}' must exist on disk at ${resolvedPath}`
      ).toBe(true);
    }
  });

  it('contains skills/unpeek/agents/openai.yaml with valid shield interface and instructions', () => {
    expect(fs.existsSync(openaiYamlPath), 'openai.yaml should exist').toBe(true);
    const yamlContent = fs.readFileSync(openaiYamlPath, 'utf8');

    expect(yamlContent).toMatch(/display_name:\s*"?unpeek"?/);
    expect(yamlContent).toMatch(/icon:\s*"?shield"?/);
  });
});
