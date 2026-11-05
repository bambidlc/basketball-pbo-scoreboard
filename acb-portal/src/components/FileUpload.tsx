import { useRef, useState } from "react";
import { Camera, Eye, FileCheck2, Trash2, Upload } from "lucide-react";
import { api, fileToUpload } from "../api";
import { Spinner, toast } from "./ui";

type Props = {
  owner: "club" | "team" | "player";
  recordId?: number;
  field: string;
  label: string;
  hint: string;
  fileName?: string;
  accept?: string;
  error?: boolean;
  disabled?: boolean;
  /** Called before uploading when the record must be saved first; returns the id. */
  ensureSaved?: () => Promise<number | undefined>;
  onChange: (name: string) => void;
  preview?: boolean;
  capture?: boolean;
};

export function FileUpload({ owner, recordId, field, label, hint, fileName, accept = "image/*,application/pdf", error, disabled, ensureSaved, onChange, preview, capture }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const url = recordId ? `/api/files/${owner}/${recordId}/${field}` : "";

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast("El archivo es muy grande (máximo 8 MB).", "error");
      return;
    }
    setBusy(true);
    try {
      const id = recordId || (await ensureSaved?.());
      if (!id) throw new Error("Guarde primero para poder subir archivos.");
      const payload = await fileToUpload(file);
      const result = await api.put<{ name: string }>(`/api/files/${owner}/${id}/${field}`, payload);
      onChange(result.name);
      setVersion((v) => v + 1);
      toast(`${label}: archivo subido`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    if (!recordId || !window.confirm("¿Eliminar este archivo?")) return;
    setBusy(true);
    try {
      await api.del(`/api/files/${owner}/${recordId}/${field}`);
      onChange("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const isImage = fileName && /\.(jpe?g|png|webp)$/i.test(fileName);
  return (
    <div className={`upload ${fileName ? "is-filled" : ""} ${error && !fileName ? "has-error" : ""}`}>
      <div className="upload__icon">
        {busy ? <Spinner /> : preview && isImage && url ? <img src={`${url}?v=${version}`} alt="" /> : fileName ? <FileCheck2 /> : capture ? <Camera /> : <Upload />}
      </div>
      <div className="upload__text">
        <b>{label}</b>
        <span>{fileName || hint}</span>
      </div>
      <div className="upload__actions">
        {fileName && url && (
          <a className="icon-btn" href={url} target="_blank" rel="noreferrer" aria-label="Ver archivo" title="Ver">
            <Eye />
          </a>
        )}
        {fileName && !disabled && (
          <button className="icon-btn" type="button" onClick={remove} aria-label="Eliminar archivo" title="Eliminar">
            <Trash2 />
          </button>
        )}
        {!disabled && (
          <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => input.current?.click()}>
            {fileName ? "Cambiar" : "Subir"}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
