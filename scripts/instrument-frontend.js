const fs = require('fs');
const path = require('path');
const { createInstrumenter } = require('istanbul-lib-instrument');

const sourceDir = path.resolve(__dirname, '..', 'frontend');
const outputDir = path.resolve(__dirname, '..', 'frontend-instrumented');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path.relative(sourceDir, absPath);
    const outPath = path.join(outputDir, relPath);

    if (entry.isDirectory()) {
      ensureDir(outPath);
      walk(absPath);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== '.js') {
      ensureDir(path.dirname(outPath));
      fs.copyFileSync(absPath, outPath);
      continue;
    }

    const code = fs.readFileSync(absPath, 'utf8');
    const instrumenter = createInstrumenter({
      coverageVariable: '__coverage__',
      esModules: false,
      produceSourceMap: false
    });

    const instrumented = instrumenter.instrumentSync(code, absPath);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, instrumented, 'utf8');
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
ensureDir(outputDir);
walk(sourceDir);

console.log(`Instrumented frontend written to: ${outputDir}`);
