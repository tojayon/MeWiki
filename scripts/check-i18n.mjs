import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = ts.createSourceFile('en.ts', fs.readFileSync(path.join(root, 'src/i18n/en.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const english = new Map();
const errors = catalog.parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
if (!catalog.statements.length) errors.push('English message catalog is empty.');
function readCatalog(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(catalog) === 'english' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name) || !ts.isStringLiteralLike(property.initializer)) throw new Error('English messages must be literal string pairs.');
      if (english.has(property.name.text)) errors.push(`Duplicate message: ${property.name.text}`);
      english.set(property.name.text, property.initializer.text);
    }
  }
  ts.forEachChild(node, readCatalog);
}
readCatalog(catalog);
const parameters = value => [...new Set(value.match(/\{\d+\}/g) ?? [])].sort().join(',');
for (const [key, value] of english) if (parameters(key) !== parameters(value)) errors.push(`Different parameters: ${key}`);
let references = 0;
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.tsx?$/.test(file) || /\.test\.ts$/.test(file) || file === path.join(root, 'src/i18n/en.ts')) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      let key;
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) key = node.arguments[0].text;
      if (ts.isTaggedTemplateExpression(node) && node.tag.getText(source) === 't') {
        const template = node.template;
        key = ts.isNoSubstitutionTemplateLiteral(template) ? template.text : template.head.text + template.templateSpans.map((span, index) => `{${index}}${span.literal.text}`).join('');
      }
      if (key !== undefined) {
        references++;
        if (!english.has(key)) errors.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} Missing English message: ${key}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'src'));
console.log(`${english.size} messages; ${references} static references; ${errors.length} issues.`);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
