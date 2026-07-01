import * as vscode from 'vscode';
import * as path from 'path';
import { Tool } from '../agent/tools.js';
import { getWorkspaceRoot } from '../utils/pathGuard.js';

// ── Database connection management ──────────────────────────────────

type DbType = 'sqlite' | 'postgresql' | 'mysql';

interface DbConnection {
    type: DbType;
    label: string;
    connectionString: string;
    handle?: any;
    client?: any;
}

const connections = new Map<string, DbConnection>();
let nextConnectionId = 1;

function sanitizeSql(input: string): string {
    return input
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
}

function isDangerous(sql: string): boolean {
    const normalized = sql.trim().toUpperCase();
    const dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'ATTACH', 'DETACH', 'LOAD_EXTENSION'];
    const first = normalized.split(/\s+/)[0];
    return dangerous.includes(first);
}

function formatAsMarkdownTable(columns: string[], rows: any[][]): string {
    if (columns.length === 0) { return '(no columns)'; }
    if (rows.length === 0) { return '(no rows)'; }

    const colWidths = columns.map((col, i) => {
        const maxData = rows.reduce((max, row) => Math.max(max, String(row[i] ?? 'NULL').length), 0);
        return Math.max(col.length, Math.min(maxData, 60));
    });

    const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 3) + '...' : s.padEnd(w);

    const header = '| ' + columns.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |';
    const sep = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';
    const data = rows.map(row =>
        '| ' + row.map((cell, i) => pad(String(cell ?? 'NULL'), colWidths[i])).join(' | ') + ' |'
    );

    return [header, sep, ...data].join('\n');
}

// ── SQLite support via dynamic import ───────────────────────────────

async function openSqlite(dbPath: string): Promise<any> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        // @ts-ignore - optional dependency
        const mod = (await import('better-sqlite3')).default;
        const Database = mod.default || mod;
        return new Database(dbPath);
    } catch {
        throw new Error(
            'better-sqlite3 is not installed. Install it with:\n' +
            '  npm install better-sqlite3\n' +
            '  npm install -D @types/better-sqlite3\n' +
            `Attempted to open: ${dbPath}`
        );
    }
}

async function getSqliteTables(db: any): Promise<string[][]> {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return rows.map((r: any) => [r.name]);
}

async function getSqliteSchema(db: any, tableName: string): Promise<string> {
    const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    if (safe !== tableName) { return `Invalid table name: ${tableName}`; }

    const columns = db.prepare(`PRAGMA table_info('${safe}')`).all();
    const indexes = db.prepare(`PRAGMA index_list('${safe}')`).all();

    let output = `## Table: \`${safe}\`\n\n`;
    output += '### Columns\n\n';
    output += formatAsMarkdownTable(
        ['cid', 'name', 'type', 'notnull', 'default', 'pk'],
        columns.map((c: any) => [c.cid, c.name, c.type, c.notnull, c.dflt_value ?? 'NULL', c.pk])
    );

    if (indexes.length > 0) {
        output += '\n\n### Indexes\n\n';
        const indexRows: any[][] = [];
        for (const idx of indexes) {
            const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
            const colNames = cols.map((c: any) => c.name).join(', ');
            indexRows.push([idx.name, idx.unique ? 'YES' : 'NO', colNames]);
        }
        output += formatAsMarkdownTable(['name', 'unique', 'columns'], indexRows);
    }

    return output;
}

async function sqliteQuery(db: any, sql: string, limit: number = 50): Promise<string> {
    const safeSql = sanitizeSql(sql);
    if (!safeSql) { return 'Empty or invalid SQL query.'; }

    if (isDangerous(safeSql)) {
        return '⛔ Write/DDL operations are not allowed. Only SELECT, EXPLAIN, SHOW, DESCRIBE, and PRAGMA queries are permitted.';
    }

    const limitedSql = safeSql.match(/^\s*SELECT\b/i)
        ? safeSql.replace(/;\s*$/, '') + ` LIMIT ${limit}`
        : safeSql;

    try {
        const stmt = db.prepare(limitedSql);
        const rows = stmt.all();
        if (!Array.isArray(rows) || rows.length === 0) {
            return 'Query returned 0 rows.';
        }
        const columns = Object.keys(rows[0]);
        const data = rows.map((r: any) => columns.map(c => r[c]));
        return formatAsMarkdownTable(columns, data) + `\n\n(${rows.length} row${rows.length !== 1 ? 's' : ''})`;
    } catch (err: any) {
        return `SQL Error: ${err.message}`;
    }
}

// ── PostgreSQL / MySQL support ──────────────────────────────────────

async function queryGeneric(conn: DbConnection, sql: string, limit: number = 50): Promise<string> {
    if (conn.type === 'postgresql') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            // @ts-ignore - optional dependency
            const pg = (await import('pg')).default;
            const { Client } = pg.default || pg;
            const client = new Client({ connectionString: conn.connectionString });
            await client.connect();
            try {
                const safeSql = sanitizeSql(sql);
                if (isDangerous(safeSql)) {
                    return '⛔ Write/DDL operations are not allowed.';
                }
                const limitedSql = safeSql.match(/^\s*SELECT\b/i)
                    ? safeSql.replace(/;\s*$/, '') + ` LIMIT ${limit}`
                    : safeSql;
                const result = await client.query(limitedSql);
                if (!result.rows || result.rows.length === 0) { return 'Query returned 0 rows.'; }
                const columns = Object.keys(result.rows[0]);
                const data = result.rows.map((r: any) => columns.map(c => r[c]));
                return formatAsMarkdownTable(columns, data) + `\n\n(${result.rows.length} row${result.rows.length !== 1 ? 's' : ''})`;
            } finally {
                await client.end();
            }
        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                return 'pg (PostgreSQL client) is not installed. Run: npm install pg';
            }
            return `PostgreSQL error: ${err.message}`;
        }
    }

    if (conn.type === 'mysql') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            // @ts-ignore - optional dependency
            const mysql = await import('mysql2/promise');
            const pool = mysql.default || mysql;
            const safeSql = sanitizeSql(sql);
            if (isDangerous(safeSql)) {
                return '⛔ Write/DDL operations are not allowed.';
            }
            const limitedSql = safeSql.match(/^\s*SELECT\b/i)
                ? safeSql.replace(/;\s*$/, '') + ` LIMIT ${limit}`
                : safeSql;
            const connection = await pool.createConnection(conn.connectionString);
            try {
                const [rows, fields] = await connection.execute(limitedSql);
                if (!Array.isArray(rows) || rows.length === 0) { return 'Query returned 0 rows.'; }
                const columns = (fields as any[]).map((f: any) => f.name);
                const data = (rows as any[]).map((r: any) => columns.map(c => r[c]));
                return formatAsMarkdownTable(columns, data) + `\n\n(${rows.length} row${rows.length !== 1 ? 's' : ''})`;
            } finally {
                await connection.end();
            }
        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                return 'mysql2 is not installed. Run: npm install mysql2';
            }
            return `MySQL error: ${err.message}`;
        }
    }

    return `Unsupported database type: ${conn.type}`;
}

async function listTablesGeneric(conn: DbConnection): Promise<string> {
    if (conn.type === 'postgresql') {
        return queryGeneric(conn, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name", 500);
    }
    if (conn.type === 'mysql') {
        return queryGeneric(conn, 'SHOW TABLES', 500);
    }
    return 'Unsupported database type';
}

async function describeTableGeneric(conn: DbConnection, tableName: string): Promise<string> {
    const safe = tableName.replace(/[^a-zA-Z0-9_.]/g, '');
    if (conn.type === 'postgresql') {
        let output = `## Table: \`${safe}\`\n\n`;
        const cols = await queryGeneric(conn,
            `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${safe}' ORDER BY ordinal_position`, 500);
        output += '### Columns\n\n' + cols;
        const idx = await queryGeneric(conn,
            `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${safe}'`, 100);
        if (!idx.includes('0 rows')) {
            output += '\n\n### Indexes\n\n' + idx;
        }
        return output;
    }
    if (conn.type === 'mysql') {
        return queryGeneric(conn, `DESCRIBE ${safe}`, 500);
    }
    return 'Unsupported database type';
}

// ── Resolve database path (relative to workspace) ───────────────────

function resolveDbPath(input: string): string {
    if (path.isAbsolute(input)) { return input; }
    try {
        return path.resolve(getWorkspaceRoot(), input);
    } catch {
        return path.resolve(input);
    }
}

// ── Tool Factories ──────────────────────────────────────────────────

export function createDbConnectTool(): Tool {
    return {
        name: 'db_connect',
        description: 'Connect to a database. For SQLite: provide a file path. For PostgreSQL/MySQL: provide a connection string (e.g. postgres://user:pass@host/db or mysql://user:pass@host/db). Returns a connection ID for use with other db_* tools.',
        promptSnippet: 'Connect to a database (SQLite, PostgreSQL, or MySQL)',
        promptGuidelines: [
            'For SQLite, provide a file path relative to the workspace',
            'For PostgreSQL/MySQL, provide a connection URI',
            'Use the returned connection_id with db_list_tables, db_query, etc.',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                connection_string: {
                    type: 'string',
                    description: 'Database file path (SQLite) or connection string (PostgreSQL/MySQL). Examples: "data.db", "postgres://user:pass@localhost:5432/mydb", "mysql://user:pass@localhost:3306/mydb"'
                },
            },
            required: ['connection_string'],
        },
        async execute(args: any) {
            try {
                const input: string = args.connection_string;
                let connType: DbType;
                let resolved: string;

                if (input.startsWith('postgres://') || input.startsWith('postgresql://')) {
                    connType = 'postgresql';
                    resolved = input;
                } else if (input.startsWith('mysql://')) {
                    connType = 'mysql';
                    resolved = input;
                } else {
                    connType = 'sqlite';
                    resolved = resolveDbPath(input);
                }

                const id = `conn_${nextConnectionId++}`;
                const conn: DbConnection = { type: connType, label: input, connectionString: resolved };
                connections.set(id, conn);

                if (connType === 'sqlite') {
                    try {
                        const db = await openSqlite(resolved);
                        conn.handle = db;
                        const tables = await getSqliteTables(db);
                        return { content: `✅ Connected to SQLite database: \`${resolved}\`\n**Connection ID:** ${id}\n**Tables:** ${tables.length}` };
                    } catch (err: any) {
                        connections.delete(id);
                        return { content: `Failed to connect to SQLite: ${err.message}`, isError: true };
                    }
                }

                return { content: `✅ Connected to ${connType} database\n**Connection ID:** ${id}\n**Target:** ${resolved}` };
            } catch (err: any) {
                return { content: `Connection error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDbListTablesTool(): Tool {
    return {
        name: 'db_list_tables',
        description: 'List all tables in a connected database. Returns table names.',
        promptSnippet: 'List tables in a connected database',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                connection_id: { type: 'string', description: 'Connection ID from db_connect' },
            },
            required: ['connection_id'],
        },
        async execute(args: any) {
            const conn = connections.get(args.connection_id);
            if (!conn) { return { content: `Unknown connection: ${args.connection_id}. Use db_connect first.`, isError: true }; }

            try {
                if (conn.type === 'sqlite') {
                    const tables = await getSqliteTables(conn.handle);
                    if (tables.length === 0) { return { content: 'No tables found in database.' }; }
                    const list = tables.map((t, i) => `${i + 1}. \`${t[0]}\``).join('\n');
                    return { content: `**Tables (${tables.length}):**\n${list}` };
                }
                return { content: await listTablesGeneric(conn) };
            } catch (err: any) {
                return { content: `Error listing tables: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDbDescribeTableTool(): Tool {
    return {
        name: 'db_describe_table',
        description: 'Show the schema of a table including columns, types, indexes, and constraints.',
        promptSnippet: 'Describe a table schema',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                connection_id: { type: 'string', description: 'Connection ID from db_connect' },
                table_name: { type: 'string', description: 'Name of the table to describe' },
            },
            required: ['connection_id', 'table_name'],
        },
        async execute(args: any) {
            const conn = connections.get(args.connection_id);
            if (!conn) { return { content: `Unknown connection: ${args.connection_id}. Use db_connect first.`, isError: true }; }

            try {
                if (conn.type === 'sqlite') {
                    return { content: await getSqliteSchema(conn.handle, args.table_name) };
                }
                return { content: await describeTableGeneric(conn, args.table_name) };
            } catch (err: any) {
                return { content: `Error describing table: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDbQueryTool(): Tool {
    return {
        name: 'db_query',
        description: 'Execute a read-only SQL query on a connected database. Results are formatted as a markdown table. Maximum 50 rows by default. Only SELECT, EXPLAIN, SHOW, DESCRIBE queries are allowed.',
        promptSnippet: 'Execute a read-only SQL query',
        parameters: {
            type: 'object' as const,
            properties: {
                connection_id: { type: 'string', description: 'Connection ID from db_connect' },
                sql: { type: 'string', description: 'SQL query to execute (read-only)' },
                limit: { type: 'number', description: 'Maximum rows to return (default: 50)' },
            },
            required: ['connection_id', 'sql'],
        },
        async execute(args: any) {
            const conn = connections.get(args.connection_id);
            if (!conn) { return { content: `Unknown connection: ${args.connection_id}. Use db_connect first.`, isError: true }; }

            const limit = Math.min(args.limit || 50, 500);

            try {
                if (conn.type === 'sqlite') {
                    return { content: await sqliteQuery(conn.handle, args.sql, limit) };
                }
                return { content: await queryGeneric(conn, args.sql, limit) };
            } catch (err: any) {
                return { content: `Query error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDbPreviewTool(): Tool {
    return {
        name: 'db_preview',
        description: 'Preview the first N rows of a table. Quick way to see sample data.',
        promptSnippet: 'Preview rows from a table',
        executionMode: 'parallel',
        parameters: {
            type: 'object' as const,
            properties: {
                connection_id: { type: 'string', description: 'Connection ID from db_connect' },
                table_name: { type: 'string', description: 'Name of the table to preview' },
                limit: { type: 'number', description: 'Number of rows to preview (default: 10)' },
            },
            required: ['connection_id', 'table_name'],
        },
        async execute(args: any) {
            const conn = connections.get(args.connection_id);
            if (!conn) { return { content: `Unknown connection: ${args.connection_id}. Use db_connect first.`, isError: true }; }

            const limit = Math.min(args.limit || 10, 100);
            const safe = args.table_name.replace(/[^a-zA-Z0-9_]/g, '');
            if (safe !== args.table_name) {
                return { content: `Invalid table name: ${args.table_name}`, isError: true };
            }

            try {
                if (conn.type === 'sqlite') {
                    return { content: await sqliteQuery(conn.handle, `SELECT * FROM "${safe}"`, limit) };
                }
                return { content: await queryGeneric(conn, `SELECT * FROM ${safe}`, limit) };
            } catch (err: any) {
                return { content: `Preview error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDbTools(): Tool[] {
    return [
        createDbConnectTool(),
        createDbListTablesTool(),
        createDbDescribeTableTool(),
        createDbQueryTool(),
        createDbPreviewTool(),
    ];
}
