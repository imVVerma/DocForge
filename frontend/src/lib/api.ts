/**
 * DocForge API service.
 * All backend communication goes through this file.
 * Base URL is read from VITE_API_URL env var (defaults to localhost:8000).
 */

import axios, { AxiosProgressEvent } from "axios";

// In dev: empty string → Vite proxies /api/* to localhost:8000 (no CORS).
// In production: VITE_API_URL is set to the deployed backend URL.
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

const client = axios.create({ baseURL: BASE_URL });

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

export interface UploadResponse {
  job_id: string;
  status: string;
  input_filenames: string[]; // actual stored filenames in upload order
}

export interface ConvertResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    file_count: number;
  };
}

export interface MergeResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    output_format: string;
    file_count: number;
  };
}

export interface ApiError {
  detail: string;
}

// ------------------------------------------------------------------ //
// Upload
// ------------------------------------------------------------------ //

export async function uploadFiles(
  files: File[],
  onProgress?: (pct: number) => void
): Promise<UploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));

  const { data } = await client.post<UploadResponse>("/api/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });

  return data;
}

// ------------------------------------------------------------------ //
// Convert
// ------------------------------------------------------------------ //

export async function convertFiles(
  jobId: string,
  targetFormat: string
): Promise<ConvertResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("target_format", targetFormat);

  const { data } = await client.post<ConvertResponse>("/api/convert", form);
  return data;
}

// ------------------------------------------------------------------ //
// Merge
// ------------------------------------------------------------------ //

export async function mergeFiles(
  jobId: string,
  orderedFilenames: string[]
): Promise<MergeResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("ordered_filenames", orderedFilenames.join(","));

  const { data } = await client.post<MergeResponse>("/api/merge", form);
  return data;
}

// ------------------------------------------------------------------ //
// Download
// ------------------------------------------------------------------ //

export function getDownloadUrl(jobId: string): string {
  return `/api/download/${jobId}`;
}

// ------------------------------------------------------------------ //
// Cleanup
// ------------------------------------------------------------------ //

export async function cleanupJob(jobId: string): Promise<void> {
  await client.delete(`/api/cleanup/${jobId}`).catch(() => {
    // Cleanup failures are non-fatal — job TTL will handle it
  });
}
