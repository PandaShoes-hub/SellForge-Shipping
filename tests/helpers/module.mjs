/* eslint-env node */
import ts from "typescript";

// Load the real route code with only external services/React context replaced.
export function asModule(source, imports = new Map(), fileName = "route.tsx") {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    transformers: {
      after: [(context) => {
        const visit = (node) => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const replacement = imports.get(node.moduleSpecifier.text);
            if (replacement) {
              return context.factory.updateImportDeclaration(
                node, node.modifiers, node.importClause,
                context.factory.createStringLiteral(replacement), node.attributes,
              );
            }
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (sourceFile) => ts.visitNode(sourceFile, visit);
      }],
    },
  });
  const errors = diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) {
    throw new Error(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
