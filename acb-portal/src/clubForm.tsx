import type { ReactNode } from "react";
import { Building2, CalendarDays, MapPinned, ShieldCheck, UserRound } from "lucide-react";
import { MUNICIPALITIES } from "../shared/tournament.js";
import { parseCourtDates } from "../shared/validation.js";
import { CourtDatesPicker } from "./components/CourtDatesPicker";
import { Check, EmailField, PhoneField, SelectField, TextArea, TextField } from "./components/ui";
import type { Club, CourtDate, Issue } from "./types";

export type ClubDraft = Partial<Club> & { courtDates?: CourtDate[] | string };
export type SetClub = <K extends keyof Club>(key: K, value: Club[K] | CourtDate[]) => void;

export const EMPTY_CLUB: ClubDraft = {
  name: "",
  acronym: "",
  phone: "",
  municipality: "",
  address: "",
  zip: "",
  founded: "",
  website: "",
  facebook: "",
  instagram: "",
  presidentName: "",
  presidentPhone: "",
  presidentEmail: "",
  contactName: "",
  contactRole: "",
  contactPhone: "",
  contactEmail: "",
  insuranceCompany: "",
  insuranceNumber: "",
  insuranceExpiry: "",
  courtName: "",
  courtAddress: "",
  courtMunicipality: "",
  courtMaps: "",
  courtIndoor: false,
  courtScoreboard: false,
  courtNotes: "",
  courtDates: [],
  comments: "",
};

export function errorFor(issues: Issue[] | undefined, field: string) {
  return issues?.find((i) => i.field === field)?.message;
}

function Section({ icon, title, sub, children, id }: { icon: ReactNode; title: string; sub?: string; children: ReactNode; id?: string }) {
  return (
    <section className="form-section" id={id}>
      <div className="form-section__head">
        <div className="form-section__icon">{icon}</div>
        <div>
          <div className="h3">{title}</div>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

type Props = { club: ClubDraft; set: SetClub; issues?: Issue[]; disabled?: boolean };

export function ClubInfoSection({ club, set, issues }: Props) {
  return (
    <Section icon={<Building2 />} title="Información del club" sub="Como aparecerá en la Lista Oficial y la Hoja de Uniformes." id="club">
      <div className="grid grid--3">
        <TextField className="span-2" label="Nombre del club" required value={club.name || ""} onChange={(v) => set("name", v)} error={errorFor(issues, "name")} maxLength={120} placeholder="Club de Baloncesto …" />
        <TextField label="Siglas" value={club.acronym || ""} onChange={(v) => set("acronym", v.toUpperCase())} maxLength={20} placeholder="CBF" hint="Opcional · se usa en los nombres de equipos" />
        <SelectField label="Municipio" required value={club.municipality || ""} onChange={(v) => set("municipality", v)} options={MUNICIPALITIES} error={errorFor(issues, "municipality")} />
        <PhoneField label="Teléfono del club" required value={club.phone || ""} onChange={(v) => set("phone", v)} error={errorFor(issues, "phone")} />
        <TextField label="Año de fundación" value={club.founded || ""} onChange={(v) => set("founded", v.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1998" />
        <TextField className="span-2" label="Dirección postal" value={club.address || ""} onChange={(v) => set("address", v)} maxLength={200} placeholder="PO Box / calle, urbanización" />
        <TextField label="Código postal" value={club.zip || ""} onChange={(v) => set("zip", v.replace(/[^\d-]/g, "").slice(0, 10))} inputMode="numeric" placeholder="00901" />
        <TextField label="Sitio web" value={club.website || ""} onChange={(v) => set("website", v)} inputMode="url" placeholder="https://" />
        <TextField label="Facebook" value={club.facebook || ""} onChange={(v) => set("facebook", v)} placeholder="facebook.com/miclub" />
        <TextField label="Instagram" value={club.instagram || ""} onChange={(v) => set("instagram", v)} placeholder="@miclub" />
      </div>
    </Section>
  );
}

export function DirectivaSection({ club, set, issues }: Props) {
  return (
    <Section icon={<UserRound />} title="Directiva y contacto" sub="El presidente firma la autorización de la liga. El contacto principal recibe los avisos de la ACB." id="directiva">
      <div className="grid grid--3">
        <TextField label="Presidente del club" required value={club.presidentName || ""} onChange={(v) => set("presidentName", v)} error={errorFor(issues, "presidentName")} maxLength={120} />
        <PhoneField label="Teléfono del presidente" required value={club.presidentPhone || ""} onChange={(v) => set("presidentPhone", v)} error={errorFor(issues, "presidentPhone")} />
        <EmailField label="Email del presidente" value={club.presidentEmail || ""} onChange={(v) => set("presidentEmail", v)} error={errorFor(issues, "presidentEmail")} />
        <TextField label="Contacto principal" required value={club.contactName || ""} onChange={(v) => set("contactName", v)} error={errorFor(issues, "contactName")} maxLength={120} />
        <TextField label="Rol del contacto" value={club.contactRole || ""} onChange={(v) => set("contactRole", v)} placeholder="Apoderado general, secretario…" maxLength={60} />
        <PhoneField label="Teléfono del contacto" required value={club.contactPhone || ""} onChange={(v) => set("contactPhone", v)} error={errorFor(issues, "contactPhone")} />
        <EmailField className="span-2" label="Email del contacto" value={club.contactEmail || ""} onChange={(v) => set("contactEmail", v)} error={errorFor(issues, "contactEmail")} />
      </div>
    </Section>
  );
}

export function CanchaSection({ club, set, issues, disabled }: Props) {
  const dates = parseCourtDates(club.courtDates) as CourtDate[];
  return (
    <>
      <Section icon={<MapPinned />} title="Cancha sede" sub="Donde el club puede recibir carnavales y juegos." id="cancha">
        <div className="grid grid--3">
          <TextField className="span-2" label="Nombre de la cancha" value={club.courtName || ""} onChange={(v) => set("courtName", v)} error={errorFor(issues, "courtName")} maxLength={120} placeholder="Coliseo / cancha / escuela" />
          <SelectField label="Municipio de la cancha" value={club.courtMunicipality || ""} onChange={(v) => set("courtMunicipality", v)} options={MUNICIPALITIES} />
          <TextField className="span-2" label="Dirección de la cancha" value={club.courtAddress || ""} onChange={(v) => set("courtAddress", v)} maxLength={200} />
          <TextField label="Enlace de mapa" value={club.courtMaps || ""} onChange={(v) => set("courtMaps", v)} placeholder="Google Maps / Waze" maxLength={300} />
          <Check checked={Boolean(club.courtIndoor)} onChange={(v) => set("courtIndoor", v)}>
            Cancha techada
          </Check>
          <Check checked={Boolean(club.courtScoreboard)} onChange={(v) => set("courtScoreboard", v)}>
            Tiene pizarra electrónica
          </Check>
          <div />
          <TextArea className="span-all" label="Notas de la cancha" value={club.courtNotes || ""} onChange={(v) => set("courtNotes", v)} placeholder="Estacionamiento, acceso, horarios de la escuela, persona a cargo…" maxLength={1000} />
        </div>
      </Section>
      <Section
        icon={<CalendarDays />}
        title="Disponibilidad para carnavales"
        sub="Marque las fechas de la temporada en que su cancha está disponible. Fecha límite: 30 de diciembre de 2026."
        id="fechas-cancha"
      >
        <CourtDatesPicker value={dates} onChange={(v) => set("courtDates", v)} disabled={disabled} />
      </Section>
    </>
  );
}

export function SeguroSection({ club, set, issues }: Props) {
  return (
    <Section icon={<ShieldCheck />} title="Póliza de seguro de accidentes del club" sub="Requerida en la Lista Oficial de Jugadores." id="seguro">
      <div className="grid grid--3">
        <TextField label="Compañía de seguros" value={club.insuranceCompany || ""} onChange={(v) => set("insuranceCompany", v)} error={errorFor(issues, "insuranceCompany")} maxLength={120} />
        <TextField label="Número de póliza" value={club.insuranceNumber || ""} onChange={(v) => set("insuranceNumber", v)} error={errorFor(issues, "insuranceNumber")} maxLength={60} />
        <TextField label="Fecha de vencimiento" type="date" value={club.insuranceExpiry || ""} onChange={(v) => set("insuranceExpiry", v)} />
      </div>
    </Section>
  );
}
