import test from 'node:test';
import assert from 'node:assert/strict';
import {getActiveHeadingId} from '../../documentation/src/utils/toc-highlight.mjs';

// Measured positions from the Spanish introduction at 1366 x 1000.
const introduction = [
  ['productos', 338, 61],
  ['ifindit-search', 429, 30],
  ['ifindit-dashboard', 561, 30],
  ['ifindit-data-catalog', 694, 30],
  ['ifindit-chatgen', 827, 30],
  ['ifindit-clasificador-de-pqrs', 960, 30],
  ['base-compartida-de-la-plataforma', 1103, 61],
  ['ifindit-lakehouse', 1193, 30],
  ['ifindit-auth-iam', 1326, 30],
  ['recursos-y-atención', 1469, 61],
];

function activeAt(scrollTop, {viewportHeight = 1000, maxScroll = 1031, navbarHeight = 80, positions = introduction} = {}) {
  const headings = positions.map(([id, documentTop, height]) => ({
    id, top: documentTop - scrollTop, bottom: documentTop + height - scrollTop,
  }));
  return getActiveHeadingId(headings, {scrollTop, maxScroll, viewportHeight, navbarHeight});
}

test('preserves ordinary section tracking before the document end', () => {
  assert.equal(activeAt(0), 'productos');
  assert.equal(activeAt(270), 'ifindit-search');
  assert.equal(activeAt(450), 'ifindit-dashboard');
});

test('allows the final shared layers to become active before the scroll limit', () => {
  assert.equal(activeAt(900), 'ifindit-lakehouse');
  assert.equal(activeAt(960), 'ifindit-auth-iam');
  assert.equal(activeAt(1031), 'recursos-y-atención');
});

test('the active section never moves backward while scrolling down through the terminal range', () => {
  const order = introduction.map(([id]) => id);
  let previous = -1;
  for (let scrollTop = 0; scrollTop <= 1031; scrollTop += 1) {
    const id = activeAt(scrollTop);
    const index = order.indexOf(id);
    assert.ok(index >= previous, `Scroll ${scrollTop}: ${id} moved backward from ${order[previous]}`);
    previous = index;
  }
});

test('handles a tall viewport when the last visible heading extends past its midpoint', () => {
  assert.equal(activeAt(800, {viewportHeight: 1200, maxScroll: 831}), 'ifindit-auth-iam');
  assert.equal(activeAt(831, {viewportHeight: 1200, maxScroll: 831}), 'recursos-y-atención');
});

test('handles a smaller viewport when the final heading can already align above the navbar', () => {
  assert.equal(activeAt(1431, {viewportHeight: 600, maxScroll: 1431}), 'recursos-y-atención');
});

test('does not highlight a final heading that is outside the viewport at the scroll limit', () => {
  const headings = [
    {id: 'first', top: 100, bottom: 130},
    {id: 'visible-final', top: 350, bottom: 380},
    {id: 'offscreen-final', top: 1100, bottom: 1130},
  ];
  assert.equal(getActiveHeadingId(headings, {scrollTop: 100, maxScroll: 100, viewportHeight: 1000, navbarHeight: 80}), 'visible-final');
});

test('a page that fits the viewport retains ordinary first-section tracking', () => {
  const positions = [['first', 100, 30], ['middle', 400, 30], ['last', 700, 30]];
  assert.equal(activeAt(0, {positions, maxScroll: 0}), 'first');
});

test('supports an empty table of contents and leaves heading geometry unchanged', () => {
  const options = {scrollTop: 100, maxScroll: 100, viewportHeight: 1000, navbarHeight: 80};
  assert.equal(getActiveHeadingId([], options), null);
  const headings = [{id: 'heading', top: 100, bottom: 130}];
  const before = structuredClone(headings);
  getActiveHeadingId(headings, options);
  assert.deepEqual(headings, before);
});
