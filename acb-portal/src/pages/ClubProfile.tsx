import { useEffect, useState } from "react";
import { Image, MessageSquare, Save } from "lucide-react";
import { api } from "../api";
import { Footer } from "../components/Brand";
import { FileUpload } from "../components/FileUpload";
import { Alert, TextArea, toast } from "../components/ui";
import { CanchaSection, ClubInfoSection, DirectivaSection, SeguroSection, type ClubDraft, type SetClub } from "../clubForm";
import { usePortal } from "../portal";
import { parseCourtDates } from "../../shared/validation.js";
import type { Club, Validation } from "../types";

export function ClubProfile() {
  const { me, setMe } = usePortal();
  const [club, setClub] = useState<ClubDraft>(() => ({ ...me.club, courtDates: parseCourtDates(me.club.courtDates) }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<Validation>(me.clubValidation);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set: SetClub = (key, value) => {
    setClub((c) => ({ ...c, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      // The server only accepts the club's editable fields; anything else is ignored.
      const result = await api.put<{ club: Club; clubValidation: Validation }>("/api/club", { club });
      setMe({ ...me, club: result.club, clubValidation: result.clubValidation });
      setValidation(result.clubValidation);
      setDirty(false);
      toast("Perfil del club guardado");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <main className="page">
        <div className="wrap" style={{ maxWidth: 1000 }}>
          <div className="page-head">
            <div>
              <p className="eyebrow">Perfil</p>
              <h1 className="display">
                Datos del <em>club</em>
              </h1>
              <p className="lead">Email de acceso: {me.club.email}. Para cambiarlo, comuníquese con la ACB.</p>
            </div>
            <button className="btn btn--primary" disabled={busy || !dirty} onClick={save}>
              <Save /> {busy ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
            </button>
          </div>

          {validation.errors.length + validation.warnings.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <Alert kind={validation.errors.length ? "error" : "warn"} title="Pendiente en el perfil">
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {[...validation.errors, ...validation.warnings].map((i) => (
                    <li key={i.field}>{i.message}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}

          <ClubInfoSection club={club} set={set} issues={validation.errors} />
          <section className="form-section">
            <div className="form-section__head">
              <div className="form-section__icon">
                <Image />
              </div>
              <div>
                <div className="h3">Logo del club</div>
                <p>Aparece en su portal. JPG o PNG.</p>
              </div>
            </div>
            <FileUpload
              owner="club"
              recordId={me.club.id}
              field="x_logo"
              label="Logo"
              hint="Suba el logo del club"
              accept="image/png,image/jpeg,image/webp"
              fileName={me.club.logoName}
              preview
              onChange={(name) => setMe({ ...me, club: { ...me.club, logoName: name } })}
            />
          </section>
          <DirectivaSection club={club} set={set} issues={validation.errors} />
          <SeguroSection club={club} set={set} issues={validation.warnings} />
          <CanchaSection club={club} set={set} issues={validation.warnings} />
          <section className="form-section">
            <div className="form-section__head">
              <div className="form-section__icon">
                <MessageSquare />
              </div>
              <div>
                <div className="h3">Comentarios para la ACB</div>
                <p>Solicitudes especiales, información adicional del club.</p>
              </div>
            </div>
            <TextArea label="Comentarios" value={club.comments || ""} onChange={(v) => set("comments", v)} maxLength={2000} />
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button className="btn btn--primary btn--lg" disabled={busy || !dirty} onClick={save}>
              <Save /> {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
