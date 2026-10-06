import assert from 'node:assert/strict';
import {
  detectFormatting,
  removeManagedColors,
  SETTINGS_JSON_PATH,
  WORKSPACE_FILE_JSON_PATH,
  type CleanRecord,
} from '../../src/core/git/cleanSettings';

const applied = {
  'statusBar.background': '#06b6d4',
  'statusBar.foreground': '#000000',
  'statusBar.inactiveBackground': '#06b6d4',
};
const fresh: CleanRecord = {
  jsonPath: SETTINGS_JSON_PATH,
  applied,
  previous: {
    'statusBar.background': null,
    'statusBar.foreground': null,
    'statusBar.inactiveBackground': null,
  },
  containerExisted: false,
};

// A committed settings file and the same file after VS Code wrote Nameplate's
// colors into it, formatted byte for byte the way VS Code's settings writer does it.
const committed = [
  '{',
  '  "editor.codeActionsOnSave": {',
  '    "source.fixAll": "explicit",',
  '    "source.organizeImports": "explicit"',
  '  }',
  '}',
  '',
].join('\n');
const colored = [
  '{',
  '  "editor.codeActionsOnSave": {',
  '    "source.fixAll": "explicit",',
  '    "source.organizeImports": "explicit"',
  '  },',
  '  "workbench.colorCustomizations": {',
  '    "statusBar.background": "#06b6d4",',
  '    "statusBar.foreground": "#000000",',
  '    "statusBar.inactiveBackground": "#06b6d4"',
  '  }',
  '}',
  '',
].join('\n');

describe('removing Nameplate colors from settings text', () => {
  it('restores the committed file byte for byte', () => {
    assert.equal(removeManagedColors(colored, fresh), committed);
  });

  it('handles CRLF line endings and tab indentation', () => {
    const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
    assert.equal(removeManagedColors(crlf(colored), fresh), crlf(committed));
    const tabs = (text: string): string =>
      text.replace(/^( {2})+/gm, (m) => '\t'.repeat(m.length / 2));
    assert.equal(removeManagedColors(tabs(colored), fresh), tabs(committed));
  });

  it("keeps the user's own color customizations and comments", () => {
    const text = [
      '{',
      '  // my theme tweaks',
      '  "workbench.colorCustomizations": {',
      '    "editor.background": "#101010",',
      '    "statusBar.background": "#06b6d4",',
      '    "statusBar.foreground": "#000000",',
      '    "statusBar.inactiveBackground": "#06b6d4"',
      '  }',
      '}',
    ].join('\n');
    const result = removeManagedColors(text, { ...fresh, containerExisted: true }) ?? '';
    assert.ok(result.includes('// my theme tweaks'));
    assert.ok(result.includes('"editor.background": "#101010"'));
    assert.ok(!result.includes('statusBar'));
  });

  it('restores values that Nameplate replaced', () => {
    const text = colored.replace('"#000000"', '"#000000"');
    const result =
      removeManagedColors(text, {
        ...fresh,
        previous: { ...fresh.previous, 'statusBar.foreground': '#abcdef' },
        containerExisted: true,
      }) ?? '';
    assert.ok(result.includes('"statusBar.foreground": "#abcdef"'));
    assert.ok(!result.includes('statusBar.background'));
  });

  it('leaves values that someone changed after Nameplate wrote them', () => {
    const changed = colored.replace(
      '"statusBar.foreground": "#000000"',
      '"statusBar.foreground": "#123456"',
    );
    const result = removeManagedColors(changed, fresh) ?? '';
    assert.ok(result.includes('"statusBar.foreground": "#123456"'));
    assert.ok(!result.includes('statusBar.background'));
  });

  it('works inside a .code-workspace file', () => {
    const workspace = [
      '{',
      '  "folders": [{ "path": "." }],',
      '  "settings": {',
      '    "editor.tabSize": 2,',
      '    "workbench.colorCustomizations": {',
      '      "statusBar.background": "#06b6d4",',
      '      "statusBar.foreground": "#000000",',
      '      "statusBar.inactiveBackground": "#06b6d4"',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const result =
      removeManagedColors(workspace, { ...fresh, jsonPath: WORKSPACE_FILE_JSON_PATH }) ?? '';
    assert.ok(!result.includes('colorCustomizations'));
    assert.ok(result.includes('"editor.tabSize": 2'));
  });

  it('returns undefined when there is nothing of Nameplate in the file', () => {
    assert.equal(removeManagedColors(committed, fresh), undefined);
    assert.equal(removeManagedColors('not json at all', fresh), undefined);
    assert.equal(removeManagedColors('{ "workbench.colorCustomizations": 5 }', fresh), undefined);
  });

  it('detects the file formatting', () => {
    assert.deepEqual(detectFormatting(colored), { insertSpaces: true, tabSize: 2, eol: '\n' });
    assert.deepEqual(detectFormatting('{\r\n\t"a": 1\r\n}'), {
      insertSpaces: false,
      tabSize: 4,
      eol: '\r\n',
    });
    assert.deepEqual(detectFormatting('{}'), { insertSpaces: true, tabSize: 4, eol: '\n' });
  });
});
