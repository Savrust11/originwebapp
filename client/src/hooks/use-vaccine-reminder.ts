import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@shared/routes";
import { useVaccinationRecords } from "@/hooks/use-app-data";
import { computeVaccineReminders, type VaccineReminder } from "@/lib/vaccine-reminder";
import type { RotavirusType } from "@/lib/vaccine-schedule";

interface UseVaccineReminderParams {
  familyId: string;
  childId: number | null;
  birthday: string | null | undefined;
  rotaType: RotavirusType;
  /** 旧logsテーブル由来の接種済みvaccineId(subType)一覧(Health.tsxと同じ互換扱い) */
  legacyVaccinationLogs?: Array<{ subType?: string | null; createdAt?: string | null }>;
}

/**
 * 予防接種リマインドの検出と通知同期を行うフック(Homeで使用)。
 * - 設定(localStorage: vaccineNotifyEnabled / vaccineNotifyDays)がONのときのみ動作
 * - 算出したリマインドをサーバーへ同期(dedupeKeyで重複防止、家族全員に配信)
 * - 新規に作成された通知のみブラウザ通知(Notification API)でも表示
 * - 同期は1日1回(家族・子ども・事前日数ごと)に抑制
 */
export function useVaccineReminderSync(params: UseVaccineReminderParams): {
  reminders: VaccineReminder[];
  enabled: boolean;
} {
  const { familyId, childId, birthday, rotaType, legacyVaccinationLogs } = params;
  const queryClient = useQueryClient();
  const { data: vaccinationRecords = [] } = useVaccinationRecords(familyId, childId ?? undefined);
  const syncingRef = useRef(false);

  const enabled = localStorage.getItem("vaccineNotifyEnabled") === "true";
  const leadDays = parseInt(localStorage.getItem("vaccineNotifyDays") || "7", 10);

  const reminders = useMemo(() => {
    if (!birthday) return [];

    const administeredVaccineIds = new Set<string>();
    const administeredDates = new Map<string, string>();
    for (const r of vaccinationRecords as Array<{ vaccineId: string; administeredDate: string; childId?: number | null }>) {
      if (childId && r.childId && r.childId !== childId) continue;
      administeredVaccineIds.add(r.vaccineId);
      const prev = administeredDates.get(r.vaccineId);
      if (!prev || r.administeredDate > prev) administeredDates.set(r.vaccineId, r.administeredDate);
    }
    // 旧logs(type=vaccination, subType=vaccineId)も接種済みとして扱う
    for (const l of legacyVaccinationLogs || []) {
      if (!l.subType) continue;
      administeredVaccineIds.add(l.subType);
      if (l.createdAt) {
        const d = l.createdAt.slice(0, 10);
        const prev = administeredDates.get(l.subType);
        if (!prev || d > prev) administeredDates.set(l.subType, d);
      }
    }

    return computeVaccineReminders({
      birthday,
      rotaType,
      administeredVaccineIds,
      administeredDates,
      leadDays: Number.isFinite(leadDays) ? leadDays : 7,
    });
  }, [birthday, rotaType, vaccinationRecords, legacyVaccinationLogs, leadDays, childId]);

  useEffect(() => {
    if (!enabled || reminders.length === 0 || !familyId) return;

    // 1日1回まで(事前日数の変更時は再同期)
    const guardKey = `vaccineReminderLastSync:${familyId}:${childId ?? "none"}`;
    const todayStamp = `${format(new Date(), "yyyy-MM-dd")}:${leadDays}`;
    if (localStorage.getItem(guardKey) === todayStamp) return;
    if (syncingRef.current) return;
    syncingRef.current = true;

    fetch("/api/vaccine-reminders/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familyId,
        childId,
        reminders: reminders.map((r) => ({
          vaccineId: r.vaccineId,
          stage: r.stage,
          message: r.message,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`sync failed: ${res.status}`);
        const data = await res.json();
        localStorage.setItem(guardKey, todayStamp);
        // 通知一覧を更新(ホームのカード表示に反映)
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) && q.queryKey[0] === api.notifications.list.path,
        });

        // 新規作成分のみブラウザ通知
        const created: Array<{ message: string }> = Array.isArray(data?.created) ? data.created : [];
        if (created.length > 0 && "Notification" in window && Notification.permission === "granted") {
          const body = created.map((c) => c.message).join("\n");
          new Notification("We育 予防接種リマインド", {
            body,
            icon: "/icon-192.png",
            tag: "vaccine-reminder",
          });
        }
      })
      .catch(() => {
        // 失敗時はガードを更新しない(次回再試行)
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [enabled, reminders, familyId, childId, leadDays, queryClient]);

  return { reminders, enabled };
}
