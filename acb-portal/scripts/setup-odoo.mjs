// Creates (idempotently) the ACB registration models in Odoo, their access
// rights, admin views and the "ACB Inscripciones" menu.
//
//   ODOO_URL=… ODOO_API_KEY=… ODOO_DB=… node scripts/setup-odoo.mjs
//
// Safe to re-run: existing models/fields are kept, views are updated in place.
// It only touches x_acb_* models — never the scoreboard's x_club/x_team/x_player.

import { fileURLToPath } from "node:url";
import { createOdoo, readDotEnv } from "../lib/odoo.mjs";
import { MODELS } from "../shared/schema.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...(await readDotEnv(`${root}.env`)), ...process.env };
const odoo = createOdoo({ url: env.ODOO_URL, apiKey: env.ODOO_API_KEY, db: env.ODOO_DB });

const log = (...args) => console.log("[setup]", ...args);
const created = [];

async function findOne(model, domain, fields = ["id"]) {
  const rows = await odoo.searchRead(model, domain, fields, { limit: 1 });
  return rows[0];
}

async function ensureModel(plan) {
  const existing = await findOne("ir.model", [["model", "=", plan.model]], ["id"]);
  if (existing) return existing.id;
  const id = await odoo.create("ir.model", {
    model: plan.model,
    name: plan.label,
    state: "manual",
    is_mail_thread: true,
    is_mail_activity: true,
  });
  created.push(plan.model);
  return id;
}

async function ensureField(plan, modelId, field) {
  const existing = await findOne("ir.model.fields", [["model", "=", plan.model], ["name", "=", field.name]], ["id"]);
  if (existing) return;
  const values = {
    name: field.name,
    field_description: field.label,
    model_id: modelId,
    ttype: field.type,
    state: "manual",
  };
  if (field.relation) values.relation = field.relation;
  if (field.relationField) values.relation_field = field.relationField;
  if (field.onDelete) values.on_delete = field.onDelete;
  if (field.type === "selection") {
    values.selection_ids = field.selection.map(([value, name], index) => [0, 0, { value, name, sequence: index + 1 }]);
  }
  await odoo.create("ir.model.fields", values);
  created.push(`${plan.model}.${field.name}`);
}

async function ensureAccess(plan, modelId, groupId) {
  const name = `${plan.model} internal users`;
  const existing = await findOne("ir.model.access", [["model_id", "=", modelId], ["name", "=", name]]);
  if (existing) return;
  await odoo.create("ir.model.access", {
    name,
    model_id: modelId,
    group_id: groupId,
    perm_read: true,
    perm_write: true,
    perm_create: true,
    perm_unlink: true,
  });
  created.push(`access:${plan.model}`);
}

async function ensureView(name, model, type, arch, priority = 5) {
  const existing = await findOne("ir.ui.view", [["name", "=", name], ["model", "=", model]]);
  if (existing) {
    await odoo.write("ir.ui.view", [existing.id], { arch_db: arch, priority });
    return existing.id;
  }
  const id = await odoo.create("ir.ui.view", { name, model, type, arch_db: arch, priority });
  created.push(`view:${name}`);
  return id;
}

async function ensureAction(name, model, extra = {}) {
  const existing = await findOne("ir.actions.act_window", [["name", "=", name], ["res_model", "=", model]]);
  const values = { name, res_model: model, view_mode: "list,form", ...extra };
  if (existing) {
    await odoo.write("ir.actions.act_window", [existing.id], values);
    return existing.id;
  }
  const id = await odoo.create("ir.actions.act_window", values);
  created.push(`action:${name}`);
  return id;
}

async function ensureMenu(name, parentId, actionId, sequence) {
  const domain = [["name", "=", name], ["parent_id", "=", parentId || false]];
  const existing = await findOne("ir.ui.menu", domain);
  const values = { name, parent_id: parentId || false, sequence };
  if (actionId) values.action = `ir.actions.act_window,${actionId}`;
  if (existing) {
    await odoo.write("ir.ui.menu", [existing.id], values);
    return existing.id;
  }
  const id = await odoo.create("ir.ui.menu", values);
  created.push(`menu:${name}`);
  return id;
}

// ---------------------------------------------------------------- models/fields
const modelIds = {};
for (const plan of MODELS) {
  modelIds[plan.model] = await ensureModel(plan);
}
for (const plan of MODELS) {
  for (const field of plan.fields.filter((f) => f.type !== "one2many")) {
    await ensureField(plan, modelIds[plan.model], field);
  }
}
for (const plan of MODELS) {
  for (const field of plan.fields.filter((f) => f.type === "one2many")) {
    await ensureField(plan, modelIds[plan.model], field);
  }
}

const groupRef = await findOne("ir.model.data", [["module", "=", "base"], ["name", "=", "group_user"]], ["res_id"]);
for (const plan of MODELS) {
  await ensureAccess(plan, modelIds[plan.model], groupRef.res_id);
}
log("models ready");

// ------------------------------------------------------------------- views
const stateBadge = (states) =>
  `widget="badge" ${states}`;
const teamBadge = stateBadge(
  `decoration-success="x_state == 'approved'" decoration-info="x_state == 'submitted'" decoration-warning="x_state == 'changes'" decoration-muted="x_state == 'draft'"`,
);

const staffGroup = (prefix, label, { card = true, shorts = false } = {}) => `
          <group string="${label}">
            <field name="x_${prefix}_name"/>
            <field name="x_${prefix}_phone" widget="phone"/>
            <field name="x_${prefix}_email" widget="email"/>
            ${card ? `<field name="x_${prefix}_lic"/>
            <field name="x_${prefix}_cert"/>
            <field name="x_${prefix}_card_name" invisible="1"/>
            <field name="x_${prefix}_card" filename="x_${prefix}_card_name"/>` : ""}
            ${shorts ? `<field name="x_${prefix}_shorts"/>
            <field name="x_${prefix}_waist" invisible="not x_${prefix}_shorts"/>` : ""}
          </group>`;

await ensureView("x_acb_club.list.acb", "x_acb_club", "list", `
<list string="Clubes ACB">
  <field name="x_name"/>
  <field name="x_acronym" optional="show"/>
  <field name="x_municipality"/>
  <field name="x_contact_name"/>
  <field name="x_contact_phone" widget="phone"/>
  <field name="x_email" widget="email"/>
  <field name="x_last_login" optional="hide"/>
  <field name="x_review" widget="badge" decoration-success="x_review == 'verified'" decoration-warning="x_review == 'new'"/>
  <field name="x_state" widget="badge" decoration-success="x_state == 'active'" decoration-danger="x_state == 'blocked'" decoration-muted="x_state == 'pending'"/>
</list>`);

await ensureView("x_acb_club.form.acb", "x_acb_club", "form", `
<form string="Club ACB">
  <header>
    <field name="x_state" widget="statusbar" options="{'clickable': '1'}"/>
  </header>
  <sheet>
    <field name="x_logo_name" invisible="1"/>
    <field name="x_logo" widget="image" class="oe_avatar" options="{'size': [96, 96]}"/>
    <div class="oe_title">
      <label for="x_name" string="Club"/>
      <h1><field name="x_name" placeholder="Nombre del club"/></h1>
      <h3><field name="x_acronym" placeholder="Siglas"/></h3>
    </div>
    <group>
      <group string="Club">
        <field name="x_review" widget="radio" options="{'horizontal': true}"/>
        <field name="x_email" widget="email"/>
        <field name="x_phone" widget="phone"/>
        <field name="x_municipality"/>
        <field name="x_address"/>
        <field name="x_zip"/>
        <field name="x_founded"/>
      </group>
      <group string="Presidente">
        <field name="x_president_name"/>
        <field name="x_president_phone" widget="phone"/>
        <field name="x_president_email" widget="email"/>
      </group>
    </group>
    <notebook>
      <page string="Equipos" name="teams">
        <field name="x_team_ids">
          <list>
            <field name="x_name"/>
            <field name="x_category"/>
            <field name="x_gender"/>
            <field name="x_program"/>
            <field name="x_coach_name"/>
            <field name="x_player_count"/>
            <field name="x_total" sum="Total"/>
            <field name="x_amount_paid" sum="Pagado"/>
            <field name="x_state" ${teamBadge}/>
          </list>
        </field>
      </page>
      <page string="Contacto y redes" name="contact">
        <group>
          <group string="Contacto principal">
            <field name="x_contact_name"/>
            <field name="x_contact_role"/>
            <field name="x_contact_phone" widget="phone"/>
            <field name="x_contact_email" widget="email"/>
          </group>
          <group string="En línea">
            <field name="x_website" widget="url"/>
            <field name="x_facebook" widget="url"/>
            <field name="x_instagram" widget="url"/>
          </group>
        </group>
      </page>
      <page string="Cancha y disponibilidad" name="court">
        <group>
          <group string="Cancha sede">
            <field name="x_court_name"/>
            <field name="x_court_address"/>
            <field name="x_court_municipality"/>
            <field name="x_court_maps" widget="url"/>
            <field name="x_court_indoor"/>
            <field name="x_court_scoreboard"/>
          </group>
          <group string="Notas">
            <field name="x_court_notes" nolabel="1" colspan="2"/>
          </group>
        </group>
        <separator string="Fechas disponibles para carnavales"/>
        <field name="x_court_dates_text" readonly="1"/>
      </page>
      <page string="Seguro" name="insurance">
        <group>
          <field name="x_insurance_company"/>
          <field name="x_insurance_number"/>
          <field name="x_insurance_expiry"/>
        </group>
      </page>
      <page string="Acceso al portal" name="access">
        <group>
          <field name="x_terms_accepted"/>
          <field name="x_terms_accepted_on"/>
          <field name="x_last_login"/>
          <field name="x_login_attempts"/>
        </group>
      </page>
      <page string="Comentarios y notas" name="notes">
        <group>
          <field name="x_comments" readonly="1"/>
          <field name="x_notes" placeholder="Notas internas, no visibles para el club"/>
        </group>
      </page>
    </notebook>
  </sheet>
  <chatter/>
</form>`);

await ensureView("x_acb_club.search.acb", "x_acb_club", "search", `
<search>
  <field name="x_name"/>
  <field name="x_municipality"/>
  <field name="x_email"/>
  <filter name="active_clubs" string="Activos" domain="[('x_state', '=', 'active')]"/>
  <filter name="pending" string="Email sin verificar" domain="[('x_state', '=', 'pending')]"/>
  <separator/>
  <filter name="review_new" string="Solicitudes nuevas" domain="[('x_review', '=', 'new')]"/>
  <filter name="review_verified" string="Verificados por la ACB" domain="[('x_review', '=', 'verified')]"/>
  <filter name="by_town" string="Municipio" context="{'group_by': 'x_municipality'}"/>
</search>`);

await ensureView("x_acb_team.list.acb", "x_acb_team", "list", `
<list string="Equipos ACB">
  <field name="x_name"/>
  <field name="x_club_id"/>
  <field name="x_category"/>
  <field name="x_gender"/>
  <field name="x_program"/>
  <field name="x_coach_name"/>
  <field name="x_player_count"/>
  <field name="x_completion" widget="progressbar"/>
  <field name="x_total" sum="Total"/>
  <field name="x_amount_paid" sum="Pagado"/>
  <field name="x_submitted_on" optional="show"/>
  <field name="x_state" ${teamBadge}/>
</list>`);

await ensureView("x_acb_team.form.acb", "x_acb_team", "form", `
<form string="Equipo ACB">
  <header>
    <field name="x_state" widget="statusbar" options="{'clickable': '1'}"/>
  </header>
  <sheet>
    <div class="oe_title">
      <h1><field name="x_name" readonly="1"/></h1>
      <h3><field name="x_club_id"/></h3>
    </div>
    <group>
      <group string="Equipo">
        <field name="x_program"/>
        <field name="x_category"/>
        <field name="x_gender"/>
        <field name="x_division"/>
        <field name="x_team_name"/>
      </group>
      <group string="Pago">
        <field name="x_payment_plan"/>
        <field name="x_fee"/>
        <field name="x_extra_fee"/>
        <field name="x_shorts_fee"/>
        <field name="x_total"/>
        <field name="x_amount_paid"/>
      </group>
    </group>
    <notebook>
      <page string="Jugadores" name="players">
        <field name="x_player_ids">
          <list editable="bottom">
            <field name="x_sequence" widget="handle"/>
            <field name="x_number"/>
            <field name="x_first_name"/>
            <field name="x_last_name"/>
            <field name="x_birthdate"/>
            <field name="x_eligibility" readonly="1"/>
            <field name="x_school" optional="show"/>
            <field name="x_grade" optional="show"/>
            <field name="x_guardian_name" optional="show"/>
            <field name="x_guardian_phone" widget="phone" optional="show"/>
            <field name="x_shirt_size"/>
            <field name="x_pants_size"/>
            <field name="x_consent"/>
            <field name="x_birth_cert_name" optional="hide"/>
          </list>
        </field>
      </page>
      <page string="Personal técnico" name="staff">
        <group>${staffGroup("coach", "Dirigente", { shorts: true })}${staffGroup("asst", "Asistente", { shorts: true })}
        </group>
        <group>${staffGroup("scorer", "Anotador")}${staffGroup("manager", "Apoderado", { card: false })}
        </group>
        <group string="Dirigentes con 2 equipos">
          <field name="x_coach_other_team"/>
          <field name="x_schedule_pref"/>
        </group>
      </page>
      <page string="Uniformes" name="uniforms">
        <group>
          <field name="x_shirt_color"/>
          <field name="x_number_color"/>
          <field name="x_pants_color"/>
        </group>
        <separator string="Resumen de tallas"/>
        <field name="x_uniform_summary" readonly="1"/>
      </page>
      <page string="Revisión ACB" name="review">
        <group>
          <field name="x_admin_feedback" placeholder="Comentarios visibles para el club en el portal"/>
          <field name="x_payment_notes"/>
          <field name="x_submitted_on"/>
          <field name="x_certify"/>
          <field name="x_certify_name"/>
          <field name="x_certify_on"/>
          <field name="x_notes" readonly="1"/>
        </group>
      </page>
    </notebook>
  </sheet>
  <chatter/>
</form>`);

await ensureView("x_acb_team.search.acb", "x_acb_team", "search", `
<search>
  <field name="x_name"/>
  <field name="x_club_id"/>
  <field name="x_coach_name"/>
  <filter name="submitted" string="Enviados" domain="[('x_state', '=', 'submitted')]"/>
  <filter name="changes" string="Requieren cambios" domain="[('x_state', '=', 'changes')]"/>
  <filter name="approved" string="Aprobados" domain="[('x_state', '=', 'approved')]"/>
  <filter name="draft" string="Borradores" domain="[('x_state', '=', 'draft')]"/>
  <separator/>
  <filter name="regular" string="ACB Regular" domain="[('x_program', '=', 'regular')]"/>
  <filter name="alternativo" string="ACB Alternativo" domain="[('x_program', '=', 'alternativo')]"/>
  <filter name="by_category" string="Categoría" context="{'group_by': 'x_category'}"/>
  <filter name="by_club" string="Club" context="{'group_by': 'x_club_id'}"/>
  <filter name="by_state" string="Estado" context="{'group_by': 'x_state'}"/>
</search>`);

await ensureView("x_acb_player.list.acb", "x_acb_player", "list", `
<list string="Jugadores ACB">
  <field name="x_number"/>
  <field name="x_name"/>
  <field name="x_team_id"/>
  <field name="x_birthdate"/>
  <field name="x_eligibility"/>
  <field name="x_school" optional="show"/>
  <field name="x_grade" optional="show"/>
  <field name="x_guardian_name"/>
  <field name="x_guardian_phone" widget="phone"/>
  <field name="x_shirt_size"/>
  <field name="x_pants_size"/>
  <field name="x_consent"/>
</list>`);

await ensureView("x_acb_player.form.acb", "x_acb_player", "form", `
<form string="Jugador ACB">
  <sheet>
    <field name="x_photo_name" invisible="1"/>
    <field name="x_photo" widget="image" class="oe_avatar" options="{'size': [96, 96]}"/>
    <div class="oe_title">
      <h1><field name="x_name" readonly="1"/></h1>
      <h3>#<field name="x_number" class="oe_inline"/> · <field name="x_team_id" class="oe_inline"/></h3>
    </div>
    <group>
      <group string="Jugador">
        <field name="x_first_name"/>
        <field name="x_last_name"/>
        <field name="x_birthdate"/>
        <field name="x_eligibility" readonly="1"/>
        <field name="x_phone" widget="phone"/>
        <field name="x_town"/>
        <field name="x_school"/>
        <field name="x_grade"/>
      </group>
      <group string="Padre, madre o encargado">
        <field name="x_guardian_name"/>
        <field name="x_guardian_relation"/>
        <field name="x_guardian_phone" widget="phone"/>
        <field name="x_guardian_email" widget="email"/>
        <field name="x_consent"/>
        <field name="x_consent_name"/>
        <field name="x_consent_on"/>
      </group>
      <group string="Uniforme">
        <field name="x_shirt_size"/>
        <field name="x_pants_size"/>
      </group>
      <group string="Documentos">
        <field name="x_birth_cert_name" invisible="1"/>
        <field name="x_birth_cert" filename="x_birth_cert_name"/>
      </group>
    </group>
  </sheet>
</form>`);

await ensureView("x_acb_player.search.acb", "x_acb_player", "search", `
<search>
  <field name="x_name"/>
  <field name="x_team_id"/>
  <field name="x_school"/>
  <filter name="no_consent" string="Sin autorización" domain="[('x_consent', '=', False)]"/>
  <filter name="by_team" string="Equipo" context="{'group_by': 'x_team_id'}"/>
</search>`);
log("views ready");

// ---------------------------------------------------------- actions & menus
const clubAction = await ensureAction("Clubes ACB", "x_acb_club", {
  help: "<p class='o_view_nocontent_smiling_face'>Aún no hay clubes inscritos</p><p>Los clubes se registran desde el Portal de Inscripción ACB.</p>",
});
const teamAction = await ensureAction("Equipos ACB", "x_acb_team", {
  context: "{'search_default_by_category': 1}",
  help: "<p class='o_view_nocontent_smiling_face'>Aún no hay equipos</p><p>Los clubes crean sus equipos desde el portal.</p>",
});
const playerAction = await ensureAction("Jugadores ACB", "x_acb_player");

const rootMenu = await ensureMenu("ACB Inscripciones", false, clubAction, 90);
await ensureMenu("Clubes", rootMenu, clubAction, 1);
await ensureMenu("Equipos", rootMenu, teamAction, 2);
await ensureMenu("Jugadores", rootMenu, playerAction, 3);
log("menus ready");

log(`created ${created.length} item(s)${created.length ? `: ${created.join(", ")}` : ""}`);
