import { describe, expect, it } from 'vitest';
import { createPackagedSkillReadTool, formatPackagedSkillFilePath } from './agent.ts';
import { buildPackagedSkill } from './skill-package.ts';
import type { PackagedSkillDirectory } from './types.ts';

const encoder = new TextEncoder();

function packagedSkill(name: string, files: Record<string, string>): PackagedSkillDirectory {
	return buildPackagedSkill({
		name,
		description: `${name} description`,
		files: Object.entries(files).map(([path, content]) => ({
			path,
			content: encoder.encode(content),
		})),
	});
}

const skill = packagedSkill('product-guide', {
	'SKILL.md': '# Product guide',
	'references/changelog/2026-10-01-x.md': 'changelog body',
	'references/pipes.md': 'pipes body',
});

function readTool(skills: Record<string, PackagedSkillDirectory>) {
	const tool = createPackagedSkillReadTool(skills);
	return (path: string) => tool.execute('call_read', { path });
}

describe('read_skill_resource', () => {
	const read = readTool({ [skill.id]: skill });

	it('reads the advertised path', async () => {
		await expect(
			read(formatPackagedSkillFilePath(skill.id, 'references/pipes.md')),
		).resolves.toMatchObject({
			content: [{ type: 'text', text: 'pipes body' }],
		});
	});

	it('reads the advertised path without its leading slash', async () => {
		const path = formatPackagedSkillFilePath(skill.id, 'references/pipes.md').slice(1);
		await expect(read(path)).resolves.toMatchObject({
			content: [{ type: 'text', text: 'pipes body' }],
		});
	});

	it('reads a path relative to the skill directory', async () => {
		await expect(read('references/pipes.md')).resolves.toMatchObject({
			content: [{ type: 'text', text: 'pipes body' }],
		});
	});

	it('reads a unique suffix of a packaged path', async () => {
		await expect(read('2026-10-01-x.md')).resolves.toMatchObject({
			content: [{ type: 'text', text: 'changelog body' }],
		});
	});

	it('names the resource paths when the hash is wrong', async () => {
		const wrongId = `${skill.id.slice(0, -1)}${skill.id.endsWith('0') ? '1' : '0'}`;
		const wrongPath = formatPackagedSkillFilePath(wrongId, 'references/pipes.md');
		await expect(read(wrongPath)).rejects.toThrow(
			`[flue] Packaged skill file not found: ${wrongPath}. Resource paths of skill "product-guide": ${formatPackagedSkillFilePath(skill.id, 'references/changelog/2026-10-01-x.md')}, ${formatPackagedSkillFilePath(skill.id, 'references/pipes.md')}`,
		);
	});

	it('names every candidate when a relative path is ambiguous', async () => {
		const other = packagedSkill('other-guide', {
			'SKILL.md': '# Other guide',
			'references/pipes.md': 'other pipes body',
		});
		const ambiguous = readTool({ [skill.id]: skill, [other.id]: other });
		await expect(ambiguous('references/pipes.md')).rejects.toThrow(
			`[flue] Packaged skill file not found: references/pipes.md. Resource paths matching "references/pipes.md": ${formatPackagedSkillFilePath(skill.id, 'references/pipes.md')}, ${formatPackagedSkillFilePath(other.id, 'references/pipes.md')}`,
		);
	});

	it('falls back to the skill resource list for an unknown path', async () => {
		await expect(read('references/typo.md')).rejects.toThrow(
			"[flue] Packaged skill file not found: references/typo.md. Use a path from the skill's resource list.",
		);
	});

	it('falls back to the skill resource list for a malformed escape', async () => {
		const path = '/.flue/packaged-skills/%E0%A4%A/references/pipes.md';
		await expect(read(path)).rejects.toThrow(
			`[flue] Packaged skill file not found: ${path}. Use a path from the skill's resource list.`,
		);
	});
});
