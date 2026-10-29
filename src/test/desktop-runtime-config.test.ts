import { expect, it } from "vitest";
import ts from "typescript";
import desktopConfigSource from "../../desktop/vite.config.ts?raw";

it("shares router and React contexts between desktop and shared components", () => {
  const source = ts.createSourceFile("vite.config.ts", desktopConfigSource, ts.ScriptTarget.Latest, true);
  const dedupe: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "dedupe"
      && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteral(element)) dedupe.push(element.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(dedupe).toEqual(expect.arrayContaining([
    "react", "react-dom", "react-router", "react-router-dom", "@tanstack/react-query",
  ]));
});
