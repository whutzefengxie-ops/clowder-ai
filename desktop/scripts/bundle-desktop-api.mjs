import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = createRequire(import.meta.url);
// Use the compiler already pinned by the API's tsx build dependency.
const { build } = createRequire(tools.resolve('tsx/package.json'))('esbuild');
const ts = tools('typescript');

function preserveModuleUrl(code, file, dist) {
  if (!code.includes('import.meta')) return code;
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const ranges = [];
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    )
      ranges.push([node.getStart(tree), node.end]);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!ranges.length) return code;
  const relative = './' + path.relative(dist, file).replaceAll('\\', '/');
  const replacement = `new URL(${JSON.stringify(relative)}, import.meta.url).href`;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
    code = code.slice(0, start) + replacement + code.slice(end);
  return code;
}

/** Keep the original dist tree for workers, dynamic paths and unbundled tooling. */
export async function bundleDesktopApi(apiRoot) {
  const dist = path.resolve(apiRoot, 'dist');
  const entry = path.join(dist, 'index.js');
  const output = path.join(dist, 'index.desktop.js');
  const result = await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: 'linked',
    metafile: true,
    logLevel: 'silent',
    plugins: [
      {
        name: 'original-module-urls',
        setup(builder) {
          builder.onLoad({ filter: /\.js$/ }, (args) => {
            if (!args.path.startsWith(dist + path.sep)) return;
            return { contents: preserveModuleUrl(fs.readFileSync(args.path, 'utf8'), args.path, dist), loader: 'js' };
          });
        },
      },
    ],
  });
  const receipt = {
    entry: 'dist/index.desktop.js',
    original: 'dist/index.js',
    modules: Object.keys(result.metafile.inputs).length,
    bytes: fs.statSync(output).size,
    originalModuleUrlsPreserved: true,
    dependenciesBundled: false,
  };
  fs.writeFileSync(path.join(dist, 'desktop-bundle.json'), JSON.stringify(receipt));
  return receipt;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  console.log(JSON.stringify(await bundleDesktopApi(path.resolve(process.argv[2]))));
