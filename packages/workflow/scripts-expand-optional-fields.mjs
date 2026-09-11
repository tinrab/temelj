import { isObject, isString } from "@temelj/value";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

// Rewrites typed object construction into ordered assignments.
// Mixed required and optional fields use intermediate inferred types for each required group.
const write = process.argv.includes("--write");

const paths = process.argv.slice(2).filter((argument) => argument !== "--write");

let count = 0;

for (const path of paths) {
  const source = readFileSync(path, "utf8");
  const parsed = parseSync(path, source);

  if (parsed.errors.length > 0) throw new Error(`Cannot parse ${path}`);
  const edits = [];
  const usedNames = new WeakMap();
  const collectionPath = fileURLToPath(new URL("./src/collection.ts", import.meta.url));
  const optionalHelpers = new Set();

  for (const statement of parsed.program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      resolve(dirname(path), statement.source.value) !== collectionPath
    )
      continue;

    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        ["optionalProperty", "optionalSortedStringSetProperty"].includes(specifier.imported.name)
      ) {
        optionalHelpers.add(specifier.local.name);
      }
    }
  }

  // A shadowed helper name cannot prove the spread's keys. Skip it throughout the file.
  function rejectShadowedHelpers(node) {
    if (!isObject(node) || node.type === "ImportDeclaration") return;
    const bindings = [];

    if (
      node.type === "VariableDeclarator" ||
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration"
    )
      bindings.push(node.id);

    if (Array.isArray(node.params)) bindings.push(...node.params);

    if (node.type === "CatchClause") bindings.push(node.param);

    function rejectBinding(binding) {
      if (!isObject(binding)) return;

      if (binding.type === "Identifier") optionalHelpers.delete(binding.name);

      for (const value of Object.values(binding)) {
        if (Array.isArray(value)) value.forEach(rejectBinding);
        else if (isObject(value)) rejectBinding(value);
      }
    }

    bindings.forEach(rejectBinding);

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(rejectShadowedHelpers);
      else if (isObject(value)) rejectShadowedHelpers(value);
    }
  }

  rejectShadowedHelpers(parsed.program);

  function safeOptionalSpread(property) {
    const call = property.type === "SpreadElement" ? property.argument : undefined;

    return (
      call?.type === "CallExpression" &&
      call.callee.type === "Identifier" &&
      optionalHelpers.has(call.callee.name) &&
      call.arguments[0]?.type === "Literal" &&
      isString(call.arguments[0].value) &&
      call.arguments[0].value !== "__proto__"
    );
  }

  const functions = new Set([
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ]);

  function safeProperties(object, allowSpread) {
    return object.properties.every((property) => {
      if (property.type === "SpreadElement")
        return (
          allowSpread || safeOptionalSpread(property) || conditionalBranch(property) !== undefined
        );

      return (
        property.type === "Property" &&
        property.kind === "init" &&
        !property.method &&
        !property.computed &&
        (property.key.name ?? property.key.value) !== "__proto__"
      );
    });
  }

  function conditionalBranch(property) {
    if (property.type !== "SpreadElement") return;
    let expression = property.argument;

    while (expression.type === "ParenthesizedExpression") expression = expression.expression;

    if (expression.type !== "ConditionalExpression") return;
    const { consequent, alternate, test } = expression;

    if (consequent.type !== "ObjectExpression" || alternate.type !== "ObjectExpression") return;

    if (!safeProperties(consequent, false) || !safeProperties(alternate, false)) return;

    if (alternate.properties.length === 0) return { test, branch: consequent, invert: false };

    if (consequent.properties.length === 0) return { test, branch: alternate, invert: true };
  }

  function appendFields(lines, name, resultType, branch) {
    for (let index = 0; index < branch.properties.length; index++) {
      const property = branch.properties[index];
      const nested = conditionalBranch(property);

      if (nested) {
        const condition = source.slice(nested.test.start, nested.test.end);
        lines.push(`if (${nested.invert ? `!(${condition})` : condition}) {`);
        appendFields(lines, name, resultType, nested.branch);
        lines.push("}");
        continue;
      }

      let end = index;

      while (end + 1 < branch.properties.length && !conditionalBranch(branch.properties[end + 1]))
        end++;
      lines.push(
        `Object.assign(${name}, {${source.slice(property.start, branch.properties[end].end)}} satisfies Partial<${resultType}>);`,
      );
      index = end;
    }
  }

  function conditionalSpreadCount(properties) {
    return properties.reduce((total, property) => {
      const conditional = conditionalBranch(property);

      return total + (conditional ? 1 + conditionalSpreadCount(conditional.branch.properties) : 0);
    }, 0);
  }

  function visit(node, owner, parent) {
    if (!isObject(node)) return;

    if (functions.has(node.type)) owner = node;

    const declaration =
      node.type === "VariableDeclaration" &&
      parent?.type === "BlockStatement" &&
      node.declarations.length === 1
        ? node.declarations[0]
        : undefined;

    const isReturn = node.type === "ReturnStatement";
    let object = isReturn ? node.argument : declaration?.init;
    let wrapper;

    if (isReturn && object?.type === "ConditionalExpression") {
      const { consequent, alternate, test } = object;

      if (consequent.type === "ObjectExpression" && alternate.type === "ObjectExpression") {
        const inverted = alternate.properties.length === 0;
        const empty = inverted ? alternate : consequent;
        const present = inverted ? consequent : alternate;
        const field = present.properties[0];

        if (
          empty.properties.length === 0 &&
          present.properties.length === 1 &&
          field.type === "Property" &&
          !field.computed &&
          !field.method &&
          field.kind === "init" &&
          field.key.type === "Identifier" &&
          field.key.name !== "__proto__" &&
          field.value.type === "ObjectExpression"
        ) {
          wrapper = {
            key: field.key.name,
            condition: source.slice(test.start, test.end),
            inverted,
          };
          object = field.value;
        }
      }
    }

    const annotationNode = isReturn
      ? owner?.returnType?.typeAnnotation
      : declaration?.id.typeAnnotation?.typeAnnotation;

    if (
      object?.type === "ObjectExpression" &&
      annotationNode &&
      (isReturn || declaration?.id.type === "Identifier")
    ) {
      const properties = object.properties;
      const first = properties.findIndex((property) => conditionalBranch(property));

      if (
        first !== -1 &&
        safeProperties(object, true) &&
        !parsed.comments.some(
          (comment) =>
            comment.start >= (wrapper ? node.start : properties[first].start) &&
            comment.end <= (wrapper ? node.end : object.end),
        ) &&
        (properties.slice(first).every((property) => conditionalBranch(property)) ||
          properties
            .slice(first)
            .every(
              (property) =>
                conditionalBranch(property) ||
                property.type === "Property" ||
                safeOptionalSpread(property),
            ))
      ) {
        const scope = owner ?? parent;

        const names =
          usedNames.get(scope) ??
          new Set(source.slice(scope.start, scope.end).match(/[A-Za-z_$][\w$]*/g));

        usedNames.set(scope, names);
        const mixed = properties.slice(first).some((property) => !conditionalBranch(property));
        let name = !mixed && declaration ? declaration.id.name : "result";
        let index = 1;

        if (!declaration || mixed) while (names.has(name)) name = `result${index++}`;
        names.add(name);

        const annotation = source.slice(annotationNode.start, annotationNode.end);

        const returnType = isReturn && owner.async ? `Awaited<${annotation}>` : annotation;

        const resultType = wrapper
          ? `NonNullable<${returnType}[${JSON.stringify(wrapper.key)}]>`
          : returnType;

        const base = source
          .slice(object.start + 1, properties[first].start)
          .trim()
          .replace(/,$/, "");

        const initializer = declaration
          ? source.slice(node.start, object.start)
          : `const ${name}: ${resultType} = `;

        const lines = mixed
          ? [`const ${name} = {${base}} satisfies Partial<${resultType}>;`]
          : [`${initializer}{${base}};`];

        if (wrapper)
          lines.unshift(
            `if (${wrapper.inverted ? `!(${wrapper.condition})` : wrapper.condition}) { return {}; }`,
          );

        const remaining = properties.slice(first);

        for (let propertyIndex = 0; propertyIndex < remaining.length; propertyIndex++) {
          const property = remaining[propertyIndex];
          const conditional = conditionalBranch(property);

          if (!conditional) {
            let end = propertyIndex;

            while (end + 1 < remaining.length && !conditionalBranch(remaining[end + 1])) end++;
            const fields = source.slice(property.start, remaining[end].end);
            let nextName;

            do nextName = `result${index++}`;
            while (names.has(nextName));
            names.add(nextName);
            lines.push(
              `const ${nextName} = Object.assign(${name}, {${fields}} satisfies Partial<${resultType}>);`,
            );
            name = nextName;
            propertyIndex = end;
            continue;
          }

          const { test, branch, invert } = conditional;
          let condition = source.slice(test.start, test.end);

          if (invert) {
            const inverse = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" };

            if (test.type === "BinaryExpression" && inverse[test.operator]) {
              condition = `${source.slice(test.left.start, test.left.end)} ${inverse[test.operator]} ${source.slice(test.right.start, test.right.end)}`;
            } else condition = `!(${condition})`;
          }

          lines.push(`if (${condition}) {`);
          appendFields(lines, name, resultType, branch);
          lines.push("}");
        }

        if (isReturn)
          lines.push(wrapper ? `return { ${wrapper.key}: ${name} };` : `return ${name};`);
        else if (mixed) lines.push(`${initializer}${name};`);
        edits.push({ start: node.start, end: node.end, text: lines.join("\n") });
        count += conditionalSpreadCount(properties);

        return;
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child, owner, node);
      else if (isObject(value)) visit(value, owner, node);
    }
  }

  visit(parsed.program);
  let output = source;

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  if (write && output !== source) writeFileSync(path, output);
}

console.log(`${write ? "Expanded" : "Would expand"} ${count} conditional spreads.`);
