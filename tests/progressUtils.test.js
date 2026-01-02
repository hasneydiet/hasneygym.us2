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

test('computeExerciseMetrics uses completed sets when present', () => {
  const { computeExerciseMetrics } = loadTypeScriptModule('./lib/progressUtils.ts');

  const sets = [
    { id: '1', set_index: 0, reps: 10, weight: 100, is_completed: false },
    { id: '2', set_index: 1, reps: 8, weight: 110, is_completed: true },
    { id: '3', set_index: 2, reps: 6, weight: 120, is_completed: true },
  ];

  const res = computeExerciseMetrics(sets);
  assert.equal(res.volume, 1600);
  assert.equal(res.bestSet, '120kg × 6');
  assert.ok(Math.abs(res.est1RM - 144) < 0.2);
});

test('computeExerciseMetrics falls back to all sets when none completed', () => {
  const { computeExerciseMetrics } = loadTypeScriptModule('./lib/progressUtils.ts');

  const sets = [
    { id: '1', set_index: 0, reps: 10, weight: 100, is_completed: false },
    { id: '2', set_index: 1, reps: 12, weight: 105, is_completed: false },
  ];

  const res = computeExerciseMetrics(sets);
  assert.equal(res.volume, 2260);
  assert.equal(res.bestSet, '105kg × 12');
});
