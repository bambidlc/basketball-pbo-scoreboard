import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../Odoo Public Html/Record View Team.html", import.meta.url), "utf8");
const start = html.indexOf("function renderEqualization(ownCount, maxAge) {");
const end = html.indexOf("function renderStatus(", start);
assert.ok(start >= 0 && end > start, "public equalization calculator exists");

function calculator() {
  const nodes = new Map();
  const opponent = { value: "9", disabled: false };
  const context = vm.createContext({
    lab: {},
    opponent,
    one: (_lab, selector) => {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: "" });
      return nodes.get(selector);
    },
    numberValue: input => Number(input.value) || 0,
  });
  vm.runInContext(html.slice(start, end), context);
  return { render: context.renderEqualization, opponent, text: selector => nodes.get(`[data-rule-${selector}]`)?.textContent };
}

test("public calculator awards equalization through 13U only", () => {
  const calc = calculator();
  calc.render(12, 13);
  assert.equal(calc.opponent.disabled, false);
  assert.equal(calc.text("difference"), "3");
  assert.match(calc.text("equal-result"), /6 puntos de equiparación/);

  for (const age of [14, 15, 16, 18]) {
    calc.render(12, age);
    assert.equal(calc.opponent.disabled, true);
    assert.equal(calc.text("difference"), "0");
    assert.match(calc.text("equal-result"), /Sin puntos de equiparación/);
  }

  calc.render(12, 13);
  assert.equal(calc.opponent.disabled, false);
  assert.match(calc.text("equal-result"), /6 puntos de equiparación/);
});
