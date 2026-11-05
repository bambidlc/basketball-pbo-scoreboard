import { useEffect, useId, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type FieldProps = {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (id: string) => ReactNode;
};

export function Field({ label, required, hint, error, className = "", children }: FieldProps) {
  const id = useId();
  return (
    <div className={`field ${error ? "has-error" : ""} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children(id)}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

type TextProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  type?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  inputMode?: "text" | "tel" | "email" | "numeric" | "url";
  autoComplete?: string;
  list?: string;
};

export function TextField({ label, value, onChange, required, hint, error, type = "text", className, ...rest }: TextProps) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className}>
      {(id) => <input id={id} className="input" type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  );
}

export function PhoneField(props: Omit<TextProps, "type" | "inputMode">) {
  return <TextField type="tel" inputMode="tel" autoComplete="tel" placeholder="787-000-0000" maxLength={30} {...props} />;
}

export function EmailField(props: Omit<TextProps, "type" | "inputMode">) {
  return <TextField type="email" inputMode="email" autoComplete="email" placeholder="nombre@email.com" maxLength={120} {...props} />;
}

export function TextArea({ label, value, onChange, required, hint, error, className, placeholder, disabled, maxLength }: TextProps) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className}>
      {(id) => (
        <textarea id={id} className="textarea" value={value ?? ""} placeholder={placeholder} disabled={disabled} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

type Option = { value: string; label: string };
export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  hint,
  error,
  className,
  placeholder = "Seleccione…",
  disabled,
}: Omit<TextProps, "type"> & { options: (Option | string)[] }) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className}>
      {(id) => (
        <select id={id} className="select" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((o) => {
            const opt = typeof o === "string" ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
      )}
    </Field>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`check ${checked ? "is-on" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  className = "",
  disabled,
  label,
}: {
  value: T | undefined | null;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" disabled={disabled} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal__head">
          <div className="h2">{title}</div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </div>
        {children}
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Cargando" />;
}

export function CenterLoad() {
  return (
    <div className="center-load">
      <Spinner />
    </div>
  );
}

export function Alert({ kind = "info", title, children }: { kind?: "info" | "warn" | "error" | "ok"; title?: ReactNode; children?: ReactNode }) {
  const Icon = kind === "ok" ? CheckCircle2 : kind === "error" ? XCircle : kind === "warn" ? AlertTriangle : Info;
  return (
    <div className={`alert alert--${kind}`}>
      <Icon />
      <div>
        {title && <b className="alert__title">{title}</b>}
        {children}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = { draft: "Borrador", submitted: "Enviado", changes: "Requiere cambios", approved: "Aprobado" };
export function StateBadge({ state }: { state: string }) {
  return <span className={`badge badge--${state || "draft"}`}>{STATE_LABEL[state] || "Borrador"}</span>;
}

export function Progress({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={`progress ${v >= 100 ? "progress--done" : ""}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
let toastId = 0;
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const item = { id: ++toastId, kind, text };
  toasts = [...toasts, item].slice(-3);
  toastListeners.forEach((fn) => fn(toasts));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    toastListeners.forEach((fn) => fn(toasts));
  }, kind === "error" ? 6000 : 3200);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    toastListeners.add(setList);
    return () => {
      toastListeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.kind === "error" ? <XCircle /> : t.kind === "ok" ? <CheckCircle2 /> : <Info />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
