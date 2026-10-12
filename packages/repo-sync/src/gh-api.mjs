import { fail } from './config.mjs';
import { command } from './process.mjs';

export async function api(path, paged = false) {
  const args = ['api', '--hostname', 'github.com', '--method', 'GET', path];
  if (paged) args.push('--paginate', '--slurp');
  const result = JSON.parse(await command('gh', args));
  return paged ? result.flat() : result;
}
export async function graphql(query, variables) {
  const args = ['api', '--hostname', 'github.com', 'graphql', '--paginate', '--slurp', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables))
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  const pages = JSON.parse(await command('gh', args));
  if (pages.some((page) => page.errors || !page.data)) fail('METADATA_INCOMPLETE', 'GitHub 元数据查询不完整，暂停');
  return pages;
}
