import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { CatCafeConfig } from '@cat-cafe/shared';

const CAT_CAFE_DIR = '.cat-cafe';
const CAT_CATALOG_FILENAME = 'cat-catalog.json';

function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

export function resolveCatCatalogPath(projectRoot: string): string {
  return safePath(projectRoot, CAT_CAFE_DIR, CAT_CATALOG_FILENAME);
}

export function readCatCatalogRaw(projectRoot: string): string | null {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  if (!existsSync(catalogPath)) return null;
  return readFileSync(catalogPath, 'utf-8');
}

export function readCatCatalog(projectRoot: string): CatCafeConfig | null {
  const raw = readCatCatalogRaw(projectRoot);
  if (raw === null) return null;
  return JSON.parse(raw) as CatCafeConfig;
}

export function bootstrapCatCatalog(projectRoot: string, templatePath: string): string {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  if (existsSync(catalogPath)) return catalogPath;

  const raw = readFileSync(templatePath, 'utf-8');
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf-8');
  return catalogPath;
}

export function writeCatCatalog(projectRoot: string, catalog: CatCafeConfig): string {
  const catalogPath = resolveCatCatalogPath(projectRoot);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
  return catalogPath;
}
