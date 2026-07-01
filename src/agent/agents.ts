import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from '../utils/config.js';

export interface AgentConfig {
    name: string;
    description: string;
    tools: string[];
    model: string;
    systemPrompt: string;
    filePath: string;
    source: 'user' | 'project';
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };
    const fm: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return { frontmatter: fm, body: match[2] };
}

function loadAgentsFromDir(dir: string, source: 'user' | 'project'): AgentConfig[] {
    const agents: AgentConfig[] = [];
    if (!fs.existsSync(dir)) return agents;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return agents; }

    for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const filePath = path.join(dir, entry);
        let content: string;
        try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
        const { frontmatter, body } = parseFrontmatter(content);
        if (!frontmatter.name) continue;

        const tools = (frontmatter.tools || '').split(',').map((t: string) => t.trim()).filter(Boolean);
        let model = frontmatter.model || '';
        model = model.replace(/\$\{([^}]+)}/g, (_: string, name: string) => process.env[name] || '');
        model = model.replace(/\$([A-Z_a-z0-9]+)/g, (_: string, name: string) => process.env[name] || '');

        agents.push({ name: frontmatter.name, description: frontmatter.description || '', tools, model, systemPrompt: body.trim(), filePath, source });
    }
    return agents;
}

export function discoverAgents(workspaceRoot?: string): AgentConfig[] {
    const config = getConfig();
    const agents: AgentConfig[] = [];
    const userDir = config.subagents.agentsDir || path.join(os.homedir(), '.pi', 'agent', 'agents');
    agents.push(...loadAgentsFromDir(userDir, 'user'));
    const bundledDir = path.join(__dirname, '..', '..', 'agents');
    agents.push(...loadAgentsFromDir(bundledDir, 'user'));
    if (workspaceRoot) {
        agents.push(...loadAgentsFromDir(path.join(workspaceRoot, '.pi', 'agent', 'agents'), 'project'));
    }
    return agents;
}

export function resolveModel(model: string): string {
    if (!model) return '';
    let r = model.replace(/\$\{([^}]+)}/g, (_: string, n: string) => process.env[n] || '');
    r = r.replace(/\$([A-Z_a-z0-9]+)/g, (_: string, n: string) => process.env[n] || '');
    return r || model;
}
