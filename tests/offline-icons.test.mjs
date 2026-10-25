import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import { checkUiStack, sourceFiles } from '../scripts/check-ui-stack.mjs';

test('the application uses one approved UI stack with no Vue or duplicate libraries', () => {
  assert.deepEqual(checkUiStack(), []);
});
test('every production Lucide icon renders as inline SVG without a network source', () => {
  const names = new Set();
  for (const file of sourceFiles('src').filter(file => /\.tsx?$/.test(file))) {
    const source = readFileSync(file,'utf8');
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) {
      for (const raw of match[1].split(',')) {
        const name=raw.trim().split(/\s+as\s+/)[0];
        if (name && !name.startsWith('type ')) names.add(name);
      }
    }
  }
  assert.ok(names.size > 25);
  for (const name of names) {
    assert.ok(lucide[name], `${name} exists`);
    const html=renderToStaticMarkup(createElement(lucide[name]));
    assert.match(html, /^<svg/);
    assert.doesNotMatch(html, /<image|<script|\shref=/);
  }
});
test('Nova sources include native hit regions for portal content', () => {
  for (const component of ['dialog','alert-dialog','popover','context-menu','dropdown-menu','select','tooltip']) {
    const source=readFileSync(`src/components/ui/${component}.tsx`,'utf8');
    assert.match(source, /nestra-hit/);
    assert.match(source, /Source: https:\/\/ui\.shadcn\.com\/r\/styles\/radix-nova/);
  }
});
