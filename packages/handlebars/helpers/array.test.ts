import { assertEquals } from "@std/assert";

import { Registry } from "../registry.ts";

Deno.test("Handlebars array helpers", () => {
  const r = new Registry().includeAllHelpers();

  assertEquals(r.render("{{array 1 2 3}}"), "1,2,3");
  assertEquals(r.render("{{arrayItemAt (array 1 2 3) 1}}"), "2");
  assertEquals(r.render("{{arrayContains (array 1 2 3) 2}}"), "true");
  assertEquals(r.render("{{arrayContains (array 1 2 3) 4}}"), "false");
  assertEquals(r.render(`{{arrayJoin (array 1 2 3) "|"}}`), "1|2|3");
});

Deno.test("Handlebars arrayFilter helper", () => {
  const r = new Registry().includeAllHelpers();

  const items = [
    { id: 1, name: "apple", active: true, type: "fruit", price: 10 },
    { id: 2, name: "banana", active: false, type: "fruit", price: 5 },
    { id: 3, name: "carrot", active: true, type: "vegetable", price: 7 },
    { id: 4, name: "date", active: true, type: "fruit", price: 15 },
  ];
  const itemsWithOwner = [
    { name: "item1", owner: { name: "Alice" } },
    { name: "item2", owner: { name: "Bob" } },
    { name: "item3", owner: { name: "Alice" } },
  ];

  // Filter active items using a simple boolean property
  let template =
    `{{#each (arrayFilter items "{{this.active}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "[apple][carrot][date]");

  // Filter by type "fruit" using 'eq' helper in the predicate
  template =
    `{{#each (arrayFilter items "{{eq this.type 'fruit'}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "[apple][banana][date]");

  // Filter by price > 8 using 'gt' helper in the predicate
  template =
    `{{#each (arrayFilter items "{{gt this.price 8}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "[apple][date]");

  // Predicate always "true" (string)
  template = `{{#each (arrayFilter items "true")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "[apple][banana][carrot][date]");

  // Predicate always "false" (string)
  template = `{{#each (arrayFilter items "false")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "");

  // Empty input array
  template =
    `{{#each (arrayFilter emptyItems "{{this.active}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { emptyItems: [] }), "");

  // Predicate with leading/trailing spaces, case-insensitive "true"
  template = `{{#each (arrayFilter items " TRUE ")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { items }), "[apple][banana][carrot][date]");

  // Predicate that results in a non-"true" string
  template =
    `{{#each (arrayFilter items "{{this.type}}")}}[{{this.name}}]{{/each}}`; // "fruit" or "vegetable" is not "true"
  assertEquals(r.render(template, { items }), "");

  // Using @root context in predicate (if applicable, though typically predicate focuses on 'this')
  // This test ensures data context is propagated.
  const contextWithRootValue = {
    items: items,
    filterValue: "fruit",
  };
  template =
    `{{#each (arrayFilter items "{{eq this.type @root.filterValue}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(
    r.render(template, contextWithRootValue),
    "[apple][banana][date]",
  );

  // Filtering with a path in 'this'
  template =
    `{{#each (arrayFilter itemsWithOwner "{{eq this.owner.name 'Alice'}}")}}[{{this.name}}]{{/each}}`;
  assertEquals(r.render(template, { itemsWithOwner }), "[item1][item3]");

  // arrayFilter with no items returns empty array
  assertEquals(
    r.render(
      '{{#if (arrayFilter items "false")}}content{{else}}no_content{{/if}}',
      { items },
    ),
    "no_content",
  );
  assertEquals(
    r.render('{{json (arrayFilter items "false")}}', { items }),
    "[]",
  );
});
