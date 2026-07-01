import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Skill types ─────────────────────────────────────────────────────

export interface SkillMetadata {
    name: string;
    description: string;
    tags: string[];
    triggers: string[];
}

export interface Skill {
    metadata: SkillMetadata;
    content: string;      // Full markdown body (after frontmatter)
    filePath: string;     // Where the skill was loaded from
}

// ── YAML frontmatter parser (lightweight, no external dep) ──────────

function parseFrontmatter(raw: string): { meta: Partial<SkillMetadata>; body: string } {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
        return { meta: {}, body: raw };
    }

    const yamlBlock = match[1];
    const body = match[2];
    const meta: Partial<SkillMetadata> = {};

    for (const line of yamlBlock.split('\n')) {
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (!kv) { continue; }
        const key = kv[1].trim().toLowerCase();
        let val = kv[2].trim();

        switch (key) {
            case 'name':
                meta.name = val;
                break;
            case 'description':
                meta.description = val;
                break;
            case 'tags':
                meta.tags = parseYamlArray(val);
                break;
            case 'triggers':
                meta.triggers = parseYamlArray(val);
                break;
        }
    }

    return { meta, body };
}

/** Parse a YAML inline array like [a, b, c] or a comma-separated string */
function parseYamlArray(val: string): string[] {
    val = val.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
        return val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    // Could be one item per line (multi-line) — handle simple case
    return val.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

// ── SkillDiscovery class ────────────────────────────────────────────

export class SkillDiscovery {
    private skills = new Map<string, Skill>();
    private _onDidChangeSkills = new vscode.EventEmitter<void>();
    readonly onDidChangeSkills = this._onDidChangeSkills.event;

    /**
     * Scan one or more directories for .md files with YAML frontmatter.
     * Later directories win on name collision (higher priority).
     */
    async discoverSkills(directories: string[]): Promise<void> {
        this.skills.clear();

        for (const dir of directories) {
            try {
                if (!fs.existsSync(dir)) { continue; }
                const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
                for (const entry of entries) {
                    const filePath = path.join(dir, entry);
                    try {
                        const raw = fs.readFileSync(filePath, 'utf-8');
                        const { meta, body } = parseFrontmatter(raw);
                        if (!meta.name) {
                            // Use filename without extension as fallback name
                            meta.name = path.basename(entry, '.md');
                        }
                        meta.description = meta.description || '';
                        meta.tags = meta.tags || [];
                        meta.triggers = meta.triggers || [];

                        this.skills.set(meta.name!, {
                            metadata: meta as SkillMetadata,
                            content: body,
                            filePath,
                        });
                    } catch (err) {
                        console.warn(`[SkillDiscovery] Failed to load ${filePath}:`, err);
                    }
                }
            } catch (err) {
                console.warn(`[SkillDiscovery] Failed to scan ${dir}:`, err);
            }
        }

        this._onDidChangeSkills.fire();
    }

    /** Get a skill by name */
    getSkill(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    /** Get all discovered skills */
    getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    /** Find skills matching a query against triggers, tags, name, or description */
    matchSkills(query: string): Skill[] {
        const q = query.toLowerCase().trim();
        if (!q) { return []; }

        const terms = q.split(/\s+/);

        return this.getAllSkills().filter(skill => {
            const searchable = [
                skill.metadata.name,
                skill.metadata.description,
                ...skill.metadata.tags,
                ...skill.metadata.triggers,
            ].join(' ').toLowerCase();

            // Check if all query terms match somewhere
            return terms.every(term => {
                // Exact trigger pattern match
                if (skill.metadata.triggers.some(t => t.toLowerCase().includes(term))) { return true; }
                // Tag match
                if (skill.metadata.tags.some(t => t.toLowerCase().includes(term))) { return true; }
                // Name/description match
                return searchable.includes(term);
            });
        });
    }

    /** Build a system prompt injection from all loaded skills */
    getSystemPromptInjection(): string {
        const skills = this.getAllSkills();
        if (skills.length === 0) { return ''; }

        const sections = skills.map(skill => {
            let section = `### Skill: ${skill.metadata.name}\n`;
            if (skill.metadata.description) {
                section += `*${skill.metadata.description}*\n\n`;
            }
            if (skill.metadata.tags.length > 0) {
                section += `Tags: ${skill.metadata.tags.join(', ')}\n\n`;
            }
            section += skill.content;
            return section;
        });

        return `## Available Skills\n\n${sections.join('\n\n---\n\n')}`;
    }

    /** Get default skill directories */
    static getDefaultDirectories(): string[] {
        const dirs: string[] = [];

        // Workspace-local skills
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            dirs.push(path.join(folders[0].uri.fsPath, '.pi-agent', 'skills'));
        }

        // Global user skills
        dirs.push(path.join(os.homedir(), '.pi-agent', 'skills'));

        return dirs;
    }

    dispose(): void {
        this._onDidChangeSkills.dispose();
    }
}
