import { navigate } from "./router";

export class ApiError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { "X-Requested-With": "acb-portal" } : { "Content-Type": "application/json", "X-Requested-With": "acb-portal" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Sin conexión. Verifique su internet e intente de nuevo.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { error, ...extra } = payload as { error?: string };
    if (response.status === 401 && !path.startsWith("/api/login")) {
      const back = window.location.pathname;
      navigate(`/mi-club${back.startsWith("/portal") ? `?next=${encodeURIComponent(back)}` : ""}`, { replace: true });
    }
    throw new ApiError(response.status, error || "Ocurrió un error. Intente de nuevo.", extra);
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T,>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T,>(path: string) => request<T>("DELETE", path),
};

/** Read a File as base64, shrinking large photos so uploads stay fast. */
export async function fileToUpload(file: File): Promise<{ name: string; data: string }> {
  const isRaster = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (isRaster && file.size > 900_000) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
      if (blob) return { name: file.name.replace(/\.\w+$/, ".jpg"), data: await blobToBase64(blob) };
    } catch {
      /* fall back to the original file */
    }
  }
  return { name: file.name, data: await blobToBase64(file) };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
