"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useBrand } from "@/components/brand/BrandProvider";
import { api, errorMessage, toApiError } from "@/lib/api";
import type { Brand } from "@/lib/brand";

import type { AssetKind, BrandAsset, BrandingAdmin, FieldValue, ValidationResult } from "./types";

/**
 * Brand editor state. Edits go to the draft (never visible to other users) and are
 * saved shortly after typing stops; every save carries the draft's row version so two
 * editors cannot silently overwrite each other.
 */
export function useBranding() {
  const { applyBrand } = useBrand();
  const [data, setData] = useState<BrandingAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<Record<string, FieldValue>>({});
  const pending = useRef<Record<string, FieldValue | number | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowVersion = useRef<number | null>(null);

  const accept = useCallback((next: BrandingAdmin) => {
    setData(next);
    rowVersion.current = next.draft?.row_version ?? null;
  }, []);

  const reload = useCallback(async () => {
    try {
      accept(await api.get<BrandingAdmin>("/branding"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [accept]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const changes = pending.current;
    if (Object.keys(changes).length === 0) return;
    pending.current = {};
    setSaving(true);
    try {
      accept(await api.put<BrandingAdmin>("/branding/draft", { changes, row_version: rowVersion.current }));
      setLocal((current) => {
        const next = { ...current };
        Object.keys(changes).forEach((k) => delete next[k]);
        return next;
      });
    } catch (e) {
      const err = toApiError(e);
      toast.error(err.message);
      setLocal((current) => {
        const next = { ...current };
        Object.keys(changes).forEach((k) => delete next[k]);
        return next;
      });
      if (err.code === "BRAND_DRAFT_CHANGED") await reload();
    } finally {
      setSaving(false);
    }
  }, [accept, reload]);

  /** Change one field locally and schedule a draft save. */
  const setField = useCallback(
    (field: string, value: FieldValue) => {
      setLocal((current) => ({ ...current, [field]: value }));
      const stored = value && typeof value === "object" ? (value as BrandAsset).id : value;
      pending.current = { ...pending.current, [field]: stored === "" ? null : stored };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const upload = useCallback(
    async (kind: AssetKind, file: File): Promise<BrandAsset | null> => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      try {
        const asset = await api.post<BrandAsset>("/branding/assets", form);
        setField(kind, asset);
        toast.success("Image processed and added to the draft");
        return asset;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [setField],
  );

  const validate = useCallback(async () => {
    await flush();
    return api.post<ValidationResult>("/branding/draft/validate");
  }, [flush]);

  const publish = useCallback(
    async (expectedRowVersion?: number) => {
      await flush();
      const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
      const result = await api.post<{ version: number; brand: Brand }>(
        "/branding/publish",
        { row_version: expectedRowVersion ?? rowVersion.current },
        { headers: { "Idempotency-Key": key } },
      );
      applyBrand(result.brand);
      // Refresh this host's server-rendered brand cache as well.
      void fetch("/api/brand/revalidate", { method: "POST" }).catch(() => undefined);
      await reload();
      return result;
    },
    [applyBrand, flush, reload],
  );

  const discard = useCallback(async () => {
    pending.current = {};
    setLocal({});
    accept(await api.delete<BrandingAdmin>("/branding/draft"));
  }, [accept]);

  const restore = useCallback(
    async (profileId: number) => {
      const result = await api.post<{ version: number; brand: Brand }>(`/branding/versions/${profileId}/restore`);
      applyBrand(result.brand);
      void fetch("/api/brand/revalidate", { method: "POST" }).catch(() => undefined);
      await reload();
      return result;
    },
    [applyBrand, reload],
  );

  /** Current value for a field: unsaved local edit, else the draft, else the published profile. */
  const valueOf = useCallback(
    (field: string): FieldValue => {
      if (field in local) return local[field];
      const profile = data?.draft ?? data?.published;
      return (profile?.fields?.[field] ?? null) as FieldValue;
    },
    [data, local],
  );

  return { data, error, saving, reload, setField, valueOf, upload, validate, publish, discard, restore, flush, dirty: Object.keys(local).length > 0 };
}
