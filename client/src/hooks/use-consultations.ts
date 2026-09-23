import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type ConsultationStatus = {
  enabled: boolean;
  authenticated: boolean;
  eligible: boolean;
  csrfToken: string | null;
  userId: string | null;
};

export type Consultation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ConsultationMessage = {
  id: string;
  content: string;
  authorType: "user";
  createdAt: string;
};

export type ConsultationDetail = {
  consultation: Consultation;
  messages: ConsultationMessage[];
};

const statusKey = ["/api/consultations/status"] as const;
const listKey = ["/api/consultations"] as const;

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...options });
  if (!response.ok) throw new Error("request_failed");
  return response.json() as Promise<T>;
}

export function useConsultationStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => readJson<ConsultationStatus>("/api/consultations/status"),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function useConsultations(userId: string | null | undefined, active: boolean, offset: number) {
  return useQuery({
    queryKey: [...listKey, userId, offset],
    queryFn: () => readJson<{ consultations: Consultation[]; nextOffset: number | null }>(`/api/consultations?offset=${offset}`),
    enabled: active,
    retry: false,
  });
}

export function useConsultation(id: string | undefined, userId: string | null | undefined, active: boolean) {
  return useQuery({
    queryKey: ["/api/consultations", userId, id],
    queryFn: () => readJson<ConsultationDetail>(`/api/consultations/${encodeURIComponent(id!)}`),
    enabled: active && Boolean(id),
    retry: false,
  });
}

export function useConsultationCache() {
  const queryClient = useQueryClient();
  return {
    refreshList: useCallback(() => queryClient.invalidateQueries({ queryKey: listKey }), [queryClient]),
    refreshDetail: useCallback((_id: string) => queryClient.invalidateQueries({ queryKey: listKey }), [queryClient]),
    clear: useCallback(() => queryClient.removeQueries({ queryKey: ["/api/consultations"] }), [queryClient]),
    resetList: useCallback(() => queryClient.removeQueries({
      predicate: query => query.queryKey[0] === "/api/consultations" && query.queryKey.length === 3,
    }), [queryClient]),
  };
}

export async function writeConsultation<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  csrfToken: string,
  body?: unknown,
): Promise<T | undefined> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 403 ? "csrf_failed" : "request_failed");
  if (response.status === 204) return undefined;
  return response.json() as Promise<T>;
}