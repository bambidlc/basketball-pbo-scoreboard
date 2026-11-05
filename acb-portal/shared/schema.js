// Odoo data model for ACB registrations. Used by scripts/setup-odoo.mjs to
// create the models/fields, and by the server as the whitelist of what the
// portal may read (portal: "r") or read and write (portal: "rw").
// Fields without `portal` are admin / server-only and never leave Odoo.

function f(name, label, type, opts = {}) {
  return { name, label, type, ...opts };
}

/** x_coach_lic → coachLic */
export function apiKey(fieldName) {
  return fieldName.replace(/^x_/, "").replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const STAFF = (prefix, roleLabel, { shorts = false, card = true } = {}) => [
  f(`x_${prefix}_name`, `${roleLabel}: nombre`, "char", { portal: "rw", max: 120 }),
  f(`x_${prefix}_phone`, `${roleLabel}: teléfono`, "char", { portal: "rw", max: 30, kind: "phone" }),
  f(`x_${prefix}_email`, `${roleLabel}: email`, "char", { portal: "rw", max: 120, kind: "email" }),
  ...(card
    ? [
        f(`x_${prefix}_lic`, `${roleLabel}: # Lic. DRD`, "char", { portal: "rw", max: 40 }),
        f(`x_${prefix}_cert`, `${roleLabel}: Cert. FBPR`, "char", { portal: "rw", max: 40 }),
        f(`x_${prefix}_card`, `${roleLabel}: copia tarjeta federativa`, "binary", { file: true }),
        f(`x_${prefix}_card_name`, `${roleLabel}: archivo tarjeta`, "char", { portal: "r" }),
      ]
    : []),
  ...(shorts
    ? [
        f(`x_${prefix}_shorts`, `${roleLabel}: pantalón corto ($25)`, "boolean", { portal: "rw" }),
        f(`x_${prefix}_waist`, `${roleLabel}: tamaño de cintura`, "char", { portal: "rw", max: 20 }),
      ]
    : []),
];

export const CLUB = {
  model: "x_acb_club",
  label: "Club ACB",
  fields: [
    f("x_name", "Nombre del club", "char", { portal: "rw", max: 120, required: true }),
    f("x_acronym", "Siglas", "char", { portal: "rw", max: 20 }),
    f("x_email", "Email de acceso", "char", { portal: "r", max: 120, kind: "email" }),
    f("x_phone", "Teléfono del club", "char", { portal: "rw", max: 30, kind: "phone", required: true }),
    f("x_municipality", "Municipio", "char", { portal: "rw", max: 60, required: true }),
    f("x_address", "Dirección postal", "char", { portal: "rw", max: 200 }),
    f("x_zip", "Código postal", "char", { portal: "rw", max: 10 }),
    f("x_founded", "Año de fundación", "char", { portal: "rw", max: 4 }),
    f("x_website", "Sitio web", "char", { portal: "rw", max: 200 }),
    f("x_facebook", "Facebook", "char", { portal: "rw", max: 200 }),
    f("x_instagram", "Instagram", "char", { portal: "rw", max: 200 }),
    f("x_president_name", "Presidente: nombre", "char", { portal: "rw", max: 120, required: true }),
    f("x_president_phone", "Presidente: teléfono", "char", { portal: "rw", max: 30, kind: "phone", required: true }),
    f("x_president_email", "Presidente: email", "char", { portal: "rw", max: 120, kind: "email" }),
    f("x_contact_name", "Contacto principal: nombre", "char", { portal: "rw", max: 120, required: true }),
    f("x_contact_role", "Contacto principal: rol", "char", { portal: "rw", max: 60 }),
    f("x_contact_phone", "Contacto principal: teléfono", "char", { portal: "rw", max: 30, kind: "phone", required: true }),
    f("x_contact_email", "Contacto principal: email", "char", { portal: "rw", max: 120, kind: "email" }),
    f("x_insurance_company", "Seguro de accidentes: compañía", "char", { portal: "rw", max: 120 }),
    f("x_insurance_number", "Seguro de accidentes: # póliza", "char", { portal: "rw", max: 60 }),
    f("x_insurance_expiry", "Seguro de accidentes: vence", "date", { portal: "rw" }),
    f("x_court_name", "Cancha sede", "char", { portal: "rw", max: 120 }),
    f("x_court_address", "Cancha: dirección", "char", { portal: "rw", max: 200 }),
    f("x_court_municipality", "Cancha: municipio", "char", { portal: "rw", max: 60 }),
    f("x_court_maps", "Cancha: enlace de mapa", "char", { portal: "rw", max: 300 }),
    f("x_court_indoor", "Cancha techada", "boolean", { portal: "rw" }),
    f("x_court_scoreboard", "Cancha con pizarra electrónica", "boolean", { portal: "rw" }),
    f("x_court_notes", "Cancha: notas", "text", { portal: "rw", max: 1000 }),
    f("x_court_dates", "Disponibilidad de cancha (JSON)", "text", { portal: "rw", json: true }),
    f("x_court_dates_text", "Disponibilidad de cancha", "text"),
    f("x_comments", "Comentarios del club", "text", { portal: "rw", max: 2000 }),
    f("x_logo", "Logo del club", "binary", { file: true }),
    f("x_logo_name", "Logo: archivo", "char", { portal: "r" }),
    f("x_terms_accepted", "Aceptó términos", "boolean", { portal: "r" }),
    f("x_terms_accepted_on", "Aceptó términos el", "datetime", { portal: "r" }),
    f("x_state", "Estado", "selection", {
      portal: "r",
      selection: [
        ["pending", "Email sin verificar"],
        ["active", "Activo"],
        ["blocked", "Bloqueado"],
      ],
    }),
    f("x_login_hash", "Código de acceso (hash)", "char"),
    f("x_login_expiry", "Código de acceso vence", "datetime"),
    f("x_login_attempts", "Intentos de acceso", "integer"),
    f("x_last_login", "Último acceso", "datetime", { portal: "r" }),
    f("x_session_version", "Versión de sesión", "integer"),
    f("x_notes", "Notas internas ACB", "text"),
    f("x_team_ids", "Equipos", "one2many", { relation: "x_acb_team", relationField: "x_club_id" }),
  ],
};

export const TEAM = {
  model: "x_acb_team",
  label: "Equipo ACB",
  fields: [
    f("x_name", "Equipo", "char", { portal: "r" }),
    f("x_club_id", "Club", "many2one", { relation: "x_acb_club", onDelete: "cascade" }),
    f("x_program", "Programa", "selection", {
      portal: "rw",
      selection: [
        ["regular", "ACB Regular"],
        ["alternativo", "ACB Alternativo"],
      ],
    }),
    f("x_category", "Categoría (edad)", "integer", { portal: "rw" }),
    f("x_gender", "Rama", "selection", {
      portal: "rw",
      selection: [
        ["M", "Masculino"],
        ["F", "Femenino"],
      ],
    }),
    f("x_division", "Letra / sección", "char", { portal: "rw", max: 10 }),
    f("x_team_name", "Nombre del equipo", "char", { portal: "rw", max: 80 }),
    f("x_shirt_color", "Color de camiseta", "char", { portal: "rw", max: 60 }),
    f("x_number_color", "Color letras y números", "char", { portal: "rw", max: 60 }),
    f("x_pants_color", "Color de pantalón", "char", { portal: "rw", max: 60 }),
    ...STAFF("coach", "Dirigente", { shorts: true }),
    ...STAFF("asst", "Asistente", { shorts: true }),
    ...STAFF("scorer", "Anotador"),
    ...STAFF("manager", "Apoderado", { card: false }),
    f("x_coach_other_team", "Dirigente con 2 equipos: otro equipo", "char", { portal: "rw", max: 160 }),
    f("x_schedule_pref", "Acomodo de horario", "selection", {
      portal: "rw",
      selection: [
        ["none", "Sin acomodo"],
        ["am", "AM (hasta el mediodía)"],
        ["pm", "PM (después del mediodía)"],
      ],
    }),
    f("x_payment_plan", "Plan de pago", "selection", {
      portal: "rw",
      selection: [
        ["full", "Pago total"],
        ["deposit", "Depósito de $400"],
      ],
    }),
    f("x_fee", "Costo de inscripción", "float", { portal: "r" }),
    f("x_extra_fee", "Uniformes adicionales", "float", { portal: "r" }),
    f("x_shorts_fee", "Pantalones de dirigentes", "float", { portal: "r" }),
    f("x_total", "Total estimado", "float", { portal: "r" }),
    f("x_amount_paid", "Pagado", "float", { portal: "r" }),
    f("x_payment_notes", "Notas de pago", "text"),
    f("x_player_count", "Jugadores", "integer", { portal: "r" }),
    f("x_completion", "Progreso (%)", "integer", { portal: "r" }),
    f("x_uniform_summary", "Resumen de uniformes", "text", { portal: "r" }),
    f("x_state", "Estado", "selection", {
      portal: "r",
      selection: [
        ["draft", "Borrador"],
        ["submitted", "Enviado"],
        ["changes", "Requiere cambios"],
        ["approved", "Aprobado"],
      ],
    }),
    f("x_admin_feedback", "Comentarios de ACB al club", "text", { portal: "r" }),
    f("x_submitted_on", "Enviado el", "datetime", { portal: "r" }),
    f("x_certify", "Certificación Regla 3", "boolean", { portal: "r" }),
    f("x_certify_name", "Certificado por", "char", { portal: "r" }),
    f("x_certify_on", "Certificado el", "datetime", { portal: "r" }),
    f("x_notes", "Notas del club", "text", { portal: "rw", max: 2000 }),
    f("x_player_ids", "Jugadores", "one2many", { relation: "x_acb_player", relationField: "x_team_id" }),
  ],
};

export const PLAYER = {
  model: "x_acb_player",
  label: "Jugador ACB",
  fields: [
    f("x_name", "Nombre completo", "char", { portal: "r" }),
    f("x_team_id", "Equipo", "many2one", { relation: "x_acb_team", onDelete: "cascade" }),
    f("x_sequence", "Orden", "integer", { portal: "rw" }),
    f("x_number", "Número", "char", { portal: "rw", max: 3 }),
    f("x_first_name", "Nombre", "char", { portal: "rw", max: 60 }),
    f("x_last_name", "Apellidos", "char", { portal: "rw", max: 80 }),
    f("x_birthdate", "Fecha de nacimiento", "date", { portal: "rw" }),
    f("x_phone", "Teléfono", "char", { portal: "rw", max: 30, kind: "phone" }),
    f("x_town", "Pueblo de residencia", "char", { portal: "rw", max: 60 }),
    f("x_school", "Escuela", "char", { portal: "rw", max: 120 }),
    f("x_grade", "Grado", "char", { portal: "rw", max: 20 }),
    f("x_guardian_name", "Padre, madre o encargado", "char", { portal: "rw", max: 120 }),
    f("x_guardian_relation", "Parentesco", "char", { portal: "rw", max: 30 }),
    f("x_guardian_phone", "Encargado: teléfono", "char", { portal: "rw", max: 30, kind: "phone" }),
    f("x_guardian_email", "Encargado: email", "char", { portal: "rw", max: 120, kind: "email" }),
    f("x_consent", "Autorización del encargado", "boolean", { portal: "rw" }),
    f("x_consent_name", "Firma electrónica del encargado", "char", { portal: "rw", max: 120 }),
    f("x_consent_on", "Autorizado el", "datetime", { portal: "r" }),
    f("x_shirt_size", "Talla de camiseta", "char", { portal: "rw", max: 20 }),
    f("x_pants_size", "Talla de pantalón", "char", { portal: "rw", max: 20 }),
    f("x_birth_cert", "Certificado de nacimiento (copia)", "binary", { file: true }),
    f("x_birth_cert_name", "Certificado: archivo", "char", { portal: "r" }),
    f("x_photo", "Foto para carnet", "binary", { file: true }),
    f("x_photo_name", "Foto: archivo", "char", { portal: "r" }),
    f("x_eligibility", "Elegibilidad", "char", { portal: "r" }),
  ],
};

export const MODELS = [CLUB, TEAM, PLAYER];

export function portalFields(model, mode = "r") {
  return model.fields.filter((field) => field.portal && (mode === "r" || field.portal === "rw"));
}

/** Files the portal may upload/download, by owner model. */
export const FILE_FIELDS = {
  club: { x_logo: { nameField: "x_logo_name", kinds: ["image"] } },
  team: {
    x_coach_card: { nameField: "x_coach_card_name", kinds: ["image", "pdf"] },
    x_asst_card: { nameField: "x_asst_card_name", kinds: ["image", "pdf"] },
    x_scorer_card: { nameField: "x_scorer_card_name", kinds: ["image", "pdf"] },
  },
  player: {
    x_birth_cert: { nameField: "x_birth_cert_name", kinds: ["image", "pdf"] },
    x_photo: { nameField: "x_photo_name", kinds: ["image"] },
  },
};
