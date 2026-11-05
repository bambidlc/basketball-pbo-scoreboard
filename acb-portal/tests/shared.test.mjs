// Rules shared by the portal UI, the API and the Odoo website.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryBirthYear, eligibility, feeForCategory, teamCosts } from "../shared/tournament.js";
import { validateClub, validateTeam } from "../shared/validation.js";
import { buildPages, esc } from "../odoo-website/content.mjs";

test("category N is for players born in 2027 − N or later", () => {
  assert.equal(categoryBirthYear(6), 2021);
  assert.equal(categoryBirthYear(19), 2008);
  assert.equal(eligibility("2017-03-14", 10).level, "ok");
  assert.equal(eligibility("2018-01-20", 10).level, "info"); // younger plays up
  assert.equal(eligibility("2016-12-31", 10).level, "error"); // older can't play down
  assert.equal(eligibility("", 10).level, "missing");
});

test("fees follow the 2027 brackets", () => {
  assert.deepEqual([6, 10, 11, 12, 13, 14, 15, 16, 17, 19].map(feeForCategory), [1099, 1099, 1199, 1199, 1275, 1275, 1299, 1299, 1500, 1500]);
  const costs = teamCosts({ category: 12 }, 13, 1);
  assert.equal(costs.extraUniforms, 1); // ACB provides 12 uniforms; #13 costs $30
  assert.equal(costs.total, 1199 + 30 + 25);
});

test("club validation flags required contacts and warns about insurance", () => {
  const { errors, warnings } = validateClub({ name: "Club", municipality: "Bayamón", phone: "7875551234" });
  assert.ok(errors.some((e) => e.field === "presidentName"));
  assert.ok(warnings.some((w) => w.field === "insuranceNumber"));
});

test("team validation catches duplicate numbers, eligibility and the 2-team coach rule", () => {
  const player = (number, birthdate) => ({
    number,
    firstName: "A",
    lastName: "B",
    birthdate,
    school: "S",
    grade: "4to",
    guardianName: "G",
    guardianPhone: "7875550000",
    consent: true,
    consentName: "G",
    shirtSize: "M (10-12)",
    pantsSize: "M (10-12)",
  });
  const team = { id: 2, program: "regular", category: 10, gender: "M", coachName: "Ana Pérez", coachLic: "DRD-1", coachPhone: "7875551111", shirtColor: "x", numberColor: "y", pantsColor: "z" };
  const players = [player("7", "2017-01-01"), player("7", "2017-02-02"), player("3", "2015-05-05")];
  const otherTeams = [{ id: 1, category: 10, coachName: "ana perez", coachLic: "DRD-1", label: "10U A" }];
  const { errors } = validateTeam(team, players, { club: {}, otherTeams });
  const messages = errors.map((e) => e.message).join("\n");
  assert.match(messages, /repetido/);
  assert.match(messages, /No elegible/);
  assert.match(messages, /misma categoría/);
  assert.match(messages, /Inscriba al menos 5 jugadores/);
});

test("website pages are generated for every banner button", () => {
  const pages = buildPages({
    portal: "https://portal.example",
    archive: "https://archive.example",
    assets: { logo: "/l.png", logoSmall: "/s.png", flyer: "/f.jpg", docs: { info: "/web/content/1?download=true" } },
    courts: [{ name: "Cancha & Coliseo", info: "Calle <1>" }],
    resoluciones: [{ year: "2023", items: [{ label: "R1", href: "https://archive.example/r1.pdf" }] }],
  });
  const urls = pages.map((p) => p.url);
  for (const url of ["/", "/itinerarios", "/tabla-de-posiciones", "/cuartos-de-final", "/todos-vs-todos", "/secciones-y-divisiones", "/canchas", "/campeones", "/resoluciones", "/directiva", "/documentos", "/reglamento", "/fotos"]) {
    assert.ok(urls.includes(url), `missing ${url}`);
  }
  const canchas = pages.find((p) => p.url === "/canchas").html;
  assert.ok(canchas.includes("Cancha &amp; Coliseo") && canchas.includes("Calle &lt;1&gt;"), "court data must be XML-escaped");
  assert.equal(esc('a&b<"c">'), "a&amp;b&lt;&quot;c&quot;&gt;");
});
