import { randomUUID } from 'crypto';

/**
 * Formato do conteúdo de um board (compatível com React Flow).
 * Nós ER: type "erTable", data { name, color, columns[] }.
 * Arestas ER: type "erRelation", sourceHandle/targetHandle = "c:<columnId>:l|r".
 */
export interface ErColumn {
  id: string;
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
  nullable?: boolean;
  unique?: boolean;
}

export interface BoardNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  [k: string]: any;
}

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  data?: Record<string, any>;
  [k: string]: any;
}

export interface BoardContent {
  version: number;
  viewport: { x: number; y: number; zoom: number };
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export const emptyContent = (): any => ({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] });

const q = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);
const unq = (name: string) => name.trim().replace(/^["`\[]|["`\]]$/g, '');
const colIdFromHandle = (h?: string | null) => (h?.startsWith('c:') ? h.split(':')[1] : undefined);

/** Gera DDL PostgreSQL a partir das tabelas ER do board. */
export function exportSql(content: BoardContent): string {
  const tables = content.nodes.filter((n) => n.type === 'erTable');
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out: string[] = [];

  for (const t of tables) {
    const cols: ErColumn[] = t.data.columns ?? [];
    const lines = cols.map((c) => {
      let l = `  ${q(c.name)} ${c.type || 'text'}`;
      if (c.nullable === false && !c.pk) l += ' NOT NULL';
      if (c.unique && !c.pk) l += ' UNIQUE';
      return l;
    });
    const pks = cols.filter((c) => c.pk).map((c) => q(c.name));
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`);
    out.push(`CREATE TABLE ${q(t.data.name)} (\n${lines.join(',\n')}\n);`);
  }

  for (const e of content.edges.filter((x) => x.type === 'erRelation')) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) continue;
    const sc = (src.data.columns as ErColumn[]).find((c) => c.id === colIdFromHandle(e.sourceHandle));
    const tc = (tgt.data.columns as ErColumn[]).find((c) => c.id === colIdFromHandle(e.targetHandle));
    if (!sc || !tc) continue;
    // A FK fica na tabela cuja coluna não é PK (lado "N").
    const [from, fc, to, toc] = sc.pk && !tc.pk ? [tgt, tc, src, sc] : [src, sc, tgt, tc];
    out.push(
      `ALTER TABLE ${q(from.data.name)} ADD FOREIGN KEY (${q(fc.name)}) REFERENCES ${q(to.data.name)} (${q(toc.name)});`,
    );
  }
  return out.join('\n\n') + '\n';
}

/** Lê DDL simples (CREATE TABLE + FKs inline/ALTER TABLE) e devolve nós/arestas ER. */
export function importSql(sql: string, origin = { x: 80, y: 80 }): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const nodes: BoardNode[] = [];
  const fks: { table: string; col: string; refTable: string; refCol: string }[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(([\s\S]*?)\)\s*;/gi;

  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(clean))) {
    const tableName = unq(m[1].split('.').pop()!);
    const columns: ErColumn[] = [];
    const pkNames = new Set<string>();

    for (const raw of splitTopLevel(m[2])) {
      const part = raw.trim();
      if (!part) continue;
      const pk = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]+)\)/i.exec(part);
      if (pk) {
        pk[1].split(',').forEach((c) => pkNames.add(unq(c)));
        continue;
      }
      const fk = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([\w."`\[\]]+)\s*\(([^)]+)\)/i.exec(part);
      if (fk) {
        fks.push({ table: tableName, col: unq(fk[1]), refTable: unq(fk[2].split('.').pop()!), refCol: unq(fk[3]) });
        continue;
      }
      if (/^(constraint|unique|check|index|key)\b/i.test(part)) continue;

      const cm = /^([\w"`\[\]]+)\s+(.+)$/s.exec(part);
      if (!cm) continue;
      const name = unq(cm[1]);
      const rest = cm[2];
      const type = rest.split(/\s+(?=not\b|null\b|primary\b|unique\b|default\b|references\b|constraint\b|check\b)/i)[0].trim();
      const col: ErColumn = {
        id: randomUUID(),
        name,
        type: type.toLowerCase(),
        pk: /primary\s+key/i.test(rest),
        nullable: !/not\s+null/i.test(rest) && !/primary\s+key/i.test(rest),
        unique: /\bunique\b/i.test(rest),
      };
      const ref = /references\s+([\w."`\[\]]+)\s*\(([^)]+)\)/i.exec(rest);
      if (ref) {
        col.fk = true;
        fks.push({ table: tableName, col: name, refTable: unq(ref[1].split('.').pop()!), refCol: unq(ref[2]) });
      }
      columns.push(col);
    }
    columns.forEach((c) => {
      if (pkNames.has(c.name)) {
        c.pk = true;
        c.nullable = false;
      }
    });

    nodes.push({
      id: randomUUID(),
      type: 'erTable',
      position: { x: origin.x + (i % 4) * 300, y: origin.y + Math.floor(i / 4) * 320 },
      data: { name: tableName, color: '#6366F1', columns },
    });
    i++;
  }

  const alterRe = /alter\s+table\s+(?:only\s+)?([\w."`\[\]]+)[\s\S]*?foreign\s+key\s*\(([^)]+)\)\s*references\s+([\w."`\[\]]+)\s*\(([^)]+)\)/gi;
  while ((m = alterRe.exec(clean))) {
    fks.push({ table: unq(m[1].split('.').pop()!), col: unq(m[2]), refTable: unq(m[3].split('.').pop()!), refCol: unq(m[4]) });
  }

  const find = (t: string) => nodes.find((n) => n.data.name.toLowerCase() === t.toLowerCase());
  const edges: BoardEdge[] = [];
  for (const fk of fks) {
    const a = find(fk.table);
    const b = find(fk.refTable);
    const ac = a?.data.columns.find((c: ErColumn) => c.name === fk.col);
    const bc = b?.data.columns.find((c: ErColumn) => c.name === fk.refCol);
    if (!a || !b || !ac || !bc) continue;
    ac.fk = true;
    // liga pelos lados que se encaram, evitando linhas que contornam a tabela
    const rightward = b.position.x >= a.position.x;
    edges.push({
      id: randomUUID(),
      source: a.id,
      sourceHandle: `c:${ac.id}:${rightward ? 'r' : 'l'}`,
      target: b.id,
      targetHandle: `c:${bc.id}:${rightward ? 'l' : 'r'}`,
      type: 'erRelation',
      data: { cardinality: 'N:1' },
    });
  }
  return { nodes, edges };
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}
