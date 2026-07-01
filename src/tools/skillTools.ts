import { Tool } from '../agent/tools';
import { SkillDiscovery } from '../agent/skills';

export function createSkillTools(discovery: SkillDiscovery): Tool[] {
    return [
        createSkillListTool(discovery),
        createSkillLoadTool(discovery),
        createSkillSearchTool(discovery),
    ];
}

function createSkillListTool(discovery: SkillDiscovery): Tool {
    return {
        name: 'skill_list',
        description: 'List all discovered skills (agent capabilities loaded from markdown files with YAML frontmatter). Shows skill names, descriptions, and tags.',
        promptSnippet: 'List available agent skills',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                tag: { type: 'string', description: 'Filter by tag (optional)' },
            },
            required: [],
        },
        async execute(args: any) {
            let skills = discovery.getAllSkills();

            if (args.tag) {
                const tag = args.tag.toLowerCase();
                skills = skills.filter(s =>
                    s.metadata.tags.some(t => t.toLowerCase() === tag)
                );
            }

            if (skills.length === 0) {
                return { content: 'No skills discovered. Place `.md` files with YAML frontmatter in `.pi-agent/skills/` (workspace) or `~/.pi-agent/skills/` (global).' };
            }

            const lines = [`**Discovered Skills (${skills.length}):**\n`];
            for (const skill of skills) {
                const tags = skill.metadata.tags.length > 0 ? ` [${skill.metadata.tags.join(', ')}]` : '';
                const triggers = skill.metadata.triggers.length > 0 ? ` | triggers: ${skill.metadata.triggers.join(', ')}` : '';
                lines.push(`- **${skill.metadata.name}**${tags}${triggers}`);
                if (skill.metadata.description) {
                    lines.push(`  ${skill.metadata.description}`);
                }
            }

            return { content: lines.join('\n') };
        },
    };
}

function createSkillLoadTool(discovery: SkillDiscovery): Tool {
    return {
        name: 'skill_load',
        description: 'Load and return the full content of a specific skill by name. Use skill_list to see available skills.',
        promptSnippet: 'Load a specific skill by name',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                name: { type: 'string', description: 'Name of the skill to load' },
            },
            required: ['name'],
        },
        async execute(args: any) {
            const skill = discovery.getSkill(args.name);
            if (!skill) {
                const available = discovery.getAllSkills().map(s => s.metadata.name).join(', ');
                return {
                    content: `Skill "${args.name}" not found. Available skills: ${available || '(none)'}`,
                    isError: true,
                };
            }

            const lines = [
                `# Skill: ${skill.metadata.name}`,
                '',
            ];
            if (skill.metadata.description) {
                lines.push(`*${skill.metadata.description}*`, '');
            }
            if (skill.metadata.tags.length > 0) {
                lines.push(`**Tags:** ${skill.metadata.tags.join(', ')}`, '');
            }
            if (skill.metadata.triggers.length > 0) {
                lines.push(`**Triggers:** ${skill.metadata.triggers.join(', ')}`, '');
            }
            lines.push('---', '');
            lines.push(skill.content);

            return { content: lines.join('\n') };
        },
    };
}

function createSkillSearchTool(discovery: SkillDiscovery): Tool {
    return {
        name: 'skill_search',
        description: 'Search skills by keyword, tag, or trigger pattern. Returns matching skills with relevance info.',
        promptSnippet: 'Search for skills by keyword or tag',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search query (matches against name, description, tags, and triggers)' },
            },
            required: ['query'],
        },
        async execute(args: any) {
            const results = discovery.matchSkills(args.query);

            if (results.length === 0) {
                return { content: `No skills found matching "${args.query}". Try skill_list to see all available skills.` };
            }

            const lines = [`**Skills matching "${args.query}" (${results.length}):**\n`];
            for (const skill of results) {
                const tags = skill.metadata.tags.length > 0 ? ` [${skill.metadata.tags.join(', ')}]` : '';
                lines.push(`- **${skill.metadata.name}**${tags}`);
                if (skill.metadata.description) {
                    lines.push(`  ${skill.metadata.description}`);
                }
                if (skill.metadata.triggers.length > 0) {
                    lines.push(`  Triggers: ${skill.metadata.triggers.join(', ')}`);
                }
                // Include a preview of the content
                const preview = skill.content.slice(0, 200).replace(/\n/g, ' ');
                if (preview) {
                    lines.push(`  Preview: ${preview}${skill.content.length > 200 ? '...' : ''}`);
                }
            }

            return { content: lines.join('\n') };
        },
    };
}
