import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(new URL('../../documentation/package.json', import.meta.url));
const braces = require('braces');
test('ordinary glob compilation, expansion and parsing remain compatible', () => {
  assert.equal(braces.compile('file-{a,b}.md'), 'file-(a|b).md');
  assert.deepEqual(braces.expand('{1..3}'), ['1', '2', '3']);
  assert.equal(braces.stringify(braces.parse('{a,b}')), '{a,b}');
});
test('advisory nested-pattern PoC fails promptly with a controlled error', () => {
  const pattern = '{'.repeat(4000) + 'x' + '}'.repeat(4000);
  for (const method of ['parse', 'compile', 'expand', 'stringify']) assert.throws(() => braces[method](pattern), {name: 'SyntaxError', message: /safe limit/});
});
test('direct AST inputs cannot bypass the nesting limit', () => {
  let ast = {type: 'text', value: 'x'};
  for (let i = 0; i < 4000; i++) ast = {type: 'brace', nodes: [ast]};
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](ast), {name: 'SyntaxError', message: /safe limit/});
});
test('cyclic AST inputs fail rather than recurse forever', () => {
  const ast = {type: 'root', nodes: []}; ast.nodes.push(ast);
  assert.throws(() => braces.compile(ast), {name: 'SyntaxError'});
});
