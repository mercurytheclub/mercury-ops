"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BOOKING_CONFIG, type BookingType, type FieldDef } from "@/lib/bookingFields";
import { loadBookingForEditAction, saveBookingAction } from "@/app/actions";
import { showToast } from "@/app/components/Toast";
import type { BookingValues } from "@/server/bookings";

const ACCENT = "#52A5D3";

type Props = {
  type: BookingType;
  tripCode: string;
  tripName?: string;
  /** edit: existing record. add: new record linked to tripRecordId. */
  variant: "edit" | "add";
  recordId?: string;
  tripRecordId?: string;
  /** Pre-fill the booking's date field (used by per-day "+ add"). */
  initialDate?: string;
  /** pill = toolbar chip, menu = dropdown row, none = no trigger (auto-opened). */
  triggerVariant?: "pill" | "menu" | "none";
  /** Open the drawer immediately on mount (for menu-driven adds). */
  defaultOpen?: boolean;
  /** Called whenever the drawer closes — lets a parent unmount this editor. */
  onClose?: () => void;
};

function emptyValues(type: BookingType, initialDate?: string): BookingValues {
  const out: BookingValues = {};
  const dateField = BOOKING_CONFIG[type].fields.find((f) => f.kind === "date")?.name;
  for (const f of BOOKING_CONFIG[type].fields) out[f.name] = f.kind === "multiselect" ? [] : "";
  if (initialDate && dateField) out[dateField] = initialDate;
  return out;
}

export function BookingEditor({
  type,
  tripCode,
  tripName,
  variant,
  recordId,
  tripRecordId,
  initialDate,
  triggerVariant = "pill",
  defaultOpen = false,
  onClose,
}: Props) {
  const cfg = BOOKING_CONFIG[type];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<BookingValues>(() => emptyValues(type, initialDate));
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();

  function close() {
    setOpen(false);
    onClose?.();
  }

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleOpen() {
    setError(null);
    setOpen(true);
    if (variant === "edit" && recordId) {
      setLoading(true);
      const loaded = await loadBookingForEditAction(type, recordId);
      setValues(loaded ?? emptyValues(type, initialDate));
      setLoading(false);
    } else {
      setValues(emptyValues(type, initialDate));
    }
  }

  // Auto-open once when requested (menu-driven add).
  useEffect(() => {
    if (defaultOpen) handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(name: string, value: string | string[]) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      const res = await saveBookingAction({
        type,
        recordId: variant === "edit" ? recordId : null,
        tripRecordId: variant === "add" ? tripRecordId : null,
        tripCode,
        tripName,
        values,
      });
      if (res.ok) {
        const label = cfg.label.charAt(0).toUpperCase() + cfg.label.slice(1);
        showToast(`${label} booking ${variant === "edit" ? "updated" : "created"}`);
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      {triggerVariant === "none" ? null : variant === "edit" ? (
        <button type="button" onClick={handleOpen} className="bk-trigger-edit label" aria-label={`Edit ${cfg.label}`}>
          edit
        </button>
      ) : triggerVariant === "menu" ? (
        <button type="button" onClick={handleOpen} className="bk-menu-item">
          {cfg.label}
        </button>
      ) : (
        <button type="button" onClick={handleOpen} className="bk-trigger-add label">
          + {cfg.label}
        </button>
      )}

      {open ? (
        <div className="bk-overlay" role="dialog" aria-modal="true" aria-label={`${variant} ${cfg.label}`}>
          <div className="bk-backdrop" onClick={() => !pending && close()} />
          <div className="bk-panel">
            <header className="bk-panel-head">
              <div>
                <span className="label" style={{ color: ACCENT, fontSize: "0.62rem" }}>
                  {variant === "edit" ? "edit" : "new"}
                </span>
                <h2 style={{ margin: "0.2rem 0 0", fontSize: "1.3rem", fontWeight: 400, textTransform: "capitalize" }}>
                  {cfg.label}
                </h2>
              </div>
              <button type="button" className="bk-close" onClick={() => !pending && close()} aria-label="Close">
                ✕
              </button>
            </header>

            <div className="bk-form">
              {loading ? (
                <p style={{ opacity: 0.5, fontFamily: "var(--font-mono), monospace", fontSize: "0.8rem" }}>loading…</p>
              ) : (
                cfg.fields.map((f) => (
                  <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => setField(f.name, v)} />
                ))
              )}
            </div>

            <footer className="bk-panel-foot">
              {error ? <p className="bk-error">{error}</p> : null}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" className="bk-btn-ghost label" onClick={() => close()} disabled={pending}>
                  cancel
                </button>
                <button type="button" className="bk-btn-save label" onClick={handleSave} disabled={pending || loading}>
                  {pending ? "saving…" : variant === "edit" ? "save changes" : "create booking"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const v = value ?? (field.kind === "multiselect" ? [] : "");
  return (
    <label className={`bk-field${field.half ? " bk-half" : ""}`}>
      <span className="bk-label label">{field.label}</span>
      {field.kind === "textarea" ? (
        <textarea className="bk-input" rows={3} placeholder={field.placeholder} value={v as string} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "select" ? (
        <select className="bk-input" value={v as string} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.kind === "multiselect" ? (
        <div className="bk-chips">
          {field.options?.map((o) => {
            const arr = (v as string[]) ?? [];
            const on = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                className={`bk-chip${on ? " bk-chip-on" : ""}`}
                onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
              >
                {o}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          className="bk-input"
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"}
          inputMode={field.kind === "number" ? "numeric" : undefined}
          placeholder={field.placeholder}
          value={v as string}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
