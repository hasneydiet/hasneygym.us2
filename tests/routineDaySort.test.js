const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTypeScriptModule(filePath) {
  const abs = path.resolve(filePath);
  const source = fs.readFileSync(abs, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: abs,
  }).outputText;

  const module = { exports: {} };
  const dirname = path.dirname(abs);
  const customRequire = (id) => {
    if (id.startsWith('./') || id.startsWith('../')) {
      const resolved = path.resolve(dirname, id);
      if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
        return loadTypeScriptModule(resolved);
      }
      if (fs.existsSync(resolved + '.ts')) {
        return loadTypeScriptModule(resolved + '.ts');
      }
      if (fs.existsSync(resolved + '.tsx')) {
        return loadTypeScriptModule(resolved + '.tsx');
      }
      return require(resolved);
    }
    return require(id);
  };

  const context = vm.createContext({
    module,
    exports: module.exports,
    require: customRequire,
    __dirname: dirname,
    __filename: abs,
    console,
    process,
  });

  const script = new vm.Script(transpiled, { filename: abs });
  script.runInContext(context);
  return module.exports;
}

test('sortRoutineDays orders by Day N label numerically (Day 10 after Day 2)', () => {
  const { sortRoutineDays } = loadTypeScriptModule('./lib/routineDaySort.ts');

  const input = [
    { id: 'a', routine_id: 'r1', name: 'Day 10', day_index: 9 },
    { id: 'b', routine_id: 'r1', name: 'Day 2', day_index: 1 },
    { id: 'c', routine_id: 'r1', name: 'Day 1', day_index: 0 },
  ];

  const out = sortRoutineDays(input);
  // Note: `sortRoutineDays` is loaded through a VM transpile helper, so arrays
  // come from a different realm. Spread into a local array before deep compare.
  assert.deepEqual([...out].map((d) => d.name), ['Day 1', 'Day 2', 'Day 10']);
});

test('sortRoutineDays does not depend on routine names (rename-safe)', () => {
  const { sortRoutineDays } = loadTypeScriptModule('./lib/routineDaySort.ts');

  const input = [
    { id: '1', routine_id: 'routineA', name: 'Day 1', day_index: 0, routineName: 'Old Name' },
    { id: '2', routine_id: 'routineA', name: 'Day 2', day_index: 1, routineName: 'New Name' },
  ];

  const out = sortRoutineDays(input);
  assert.deepEqual([...out].map((d) => d.id), ['1', '2']);
});

test('sortRoutineDays falls back to day_index when label is missing or not parseable', () => {
  const { sortRoutineDays } = loadTypeScriptModule('./lib/routineDaySort.ts');

  const input = [
    { id: 'x', routine_id: 'r1', name: 'Upper', day_index: 1 },
    { id: 'y', routine_id: 'r1', name: null, day_index: 0 },
  ];

  const out = sortRoutineDays(input);
  assert.deepEqual([...out].map((d) => d.id), ['y', 'x']);
});