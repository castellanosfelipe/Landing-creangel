import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Upstream braces #70 / GHSA-vfj7-8cjw-p6xm has no patched release.
// Fail closed on a different upstream source. Keep the real version visible
// to SCA, while bounding parser and recursive AST-walker depth locally.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const signatures = {
  parse: 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310',
  compile: 'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f',
  expand: '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7',
  stringify: '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a',
};
const patchedSignatures = {
  parse: '9e2eb8f18241becb1f381a8d74e526c3bd87b3784241ed128449348c3b287113',
  compile: '3f616ecc8c728894921f82589e43bb68fbee7ea1b5685770c5140a99bef74be1',
  expand: 'b0ac2bcf826f0f67e9ce2c97a8527db0fcbf7e0e6f424866655ce02515bceab1',
  stringify: '2ddd53cab27bb34528d16f47c3b31190d956b2ab0a8e8ffa05d4504b4a9832f1',
};
const guard = `'use strict';
// Iterative traversal avoids the same recursion this guard protects.
module.exports = function assertDepth(ast) {
  const stack = [[ast, 0]];
  const seen = new Set();
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (depth > 100 || seen.has(node)) throw new SyntaxError('Brace nesting exceeds safe limit (100)');
    if (!node || typeof node !== 'object') continue;
    seen.add(node);
    if (node.nodes) for (const child of node.nodes) stack.push([child, depth + 1]);
  }
};
`;
for (const scope of ['', 'documentation']) {
  const directory = path.join(root, scope, 'node_modules/braces');
  if (!fs.existsSync(directory)) continue;
  if (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== '3.0.3') throw new Error('Review braces patch for new package version.');
  for (const [name, expected] of Object.entries(signatures)) {
    const file = path.join(directory, 'lib', `${name}.js`);
    let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (source.startsWith('// Creangel bounded braces AST\n')) {
      if (createHash('sha256').update(source).digest('hex') !== patchedSignatures[name]) throw new Error(`Unexpected patched braces source: ${name}`);
      continue;
    }
    if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error(`Unexpected upstream braces source: ${name}`);
    if (name === 'parse') source = source.replace('while (index < length) {', "while (index < length) {\n    if (stack.length > 100) throw new SyntaxError('Brace nesting exceeds safe limit (100)');");
    else {
      const declaration = name === 'stringify' ? 'module.exports = (ast, options = {}) => {' : `const ${name} = (ast, options = {}) => {`;
      source = source.replace(declaration, `${declaration}\n  require('./safe-depth')(ast);`);
    }
    fs.writeFileSync(file, '// Creangel bounded braces AST\n' + source);
  }
  fs.writeFileSync(path.join(directory, 'lib/safe-depth.js'), guard);
  console.log(`Applied bounded braces AST patch (${scope || 'root'}).`);
}
