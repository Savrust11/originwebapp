import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronLeft, ChevronRight, BookHeart, Plus, ImagePlus, X, Lock, Users,
  Sun, Cloud, CloudRain, Snowflake, Smile, Frown, Meh, Heart, Zap, Trash2, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiaryEntry } from "@shared/schema";

const MOODS = [
  { value: "happy", label: "嬉しい", icon: Smile, color: "text-rose-500 bg-rose-50 dark:bg-rose-950/40" },
  { value: "calm", label: "穏やか", icon: Heart, color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  { value: "tired", label: "疲れた", icon: Meh, color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  { value: "sad", label: "悲しい", icon: Frown, color: "text-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { value: "excited", label: "わくわく", icon: Zap, color: "text-purple-500 bg-purple-50 dark:bg-purple-950/40" },
];

const WEATHERS = [
  { value: "sunny", label: "晴れ", icon: Sun, color: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  { value: "cloudy", label: "くもり", icon: Cloud, color: "text-slate-500 bg-slate-100 dark:bg-slate-800" },
  { value: "rainy", label: "雨", icon: CloudRain, color: "text-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { value: "snowy", label: "雪", icon: Snowflake, color: "text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40" },
];

const TAG_PRESETS = ["はじめて", "おでかけ", "成長", "イベント", "通院", "家族", "笑顔", "感動"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

async function compressImage(file: File, maxDim = 1024, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target?.result as string; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Diary() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const familyId = localStorage.getItem("familyId") || "default";
  const userType = localStorage.getItem("userType") || "papa";

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const { data: entries = [], isLoading } = useQuery<DiaryEntry[]>({
    queryKey: ["/api/diaries", familyId, userType],
    queryFn: async () => {
      const res = await fetch(`/api/diaries?familyId=${encodeURIComponent(familyId)}&userId=${encodeURIComponent(userType)}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const entriesByDate = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const e of entries) {
      const key = e.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entries]);

  const calendarDays = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const startWeekday = first.getDay();
    const days: { date: Date | null; key: string }[] = [];
    for (let i = 0; i < startWeekday; i++) days.push({ date: null, key: `pad-${i}` });
    for (let d = 1; d <= last.getDate(); d++) {
      const dt = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      days.push({ date: dt, key: ymd(dt) });
    }
    while (days.length % 7 !== 0) days.push({ date: null, key: `pad-end-${days.length}` });
    return days;
  }, [cursor]);

  const todayKey = ymd(new Date());
  const selectedEntries = selectedDate ? (entriesByDate.get(selectedDate) || []) : [];

  const openNew = (date: string) => {
    setEditingEntry(null);
    setSelectedDate(date);
    setEditorOpen(true);
  };
  const openEdit = (e: DiaryEntry) => {
    setEditingEntry(e);
    setSelectedDate(e.date);
    setEditorOpen(true);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/diaries/${id}`, { familyId, userId: userType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaries", familyId] });
      toast({ title: "日記を削除しました" });
      setDeleteTargetId(null);
    },
    onError: () => toast({ title: "削除に失敗しました", variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50/50 to-white dark:from-[hsl(270_25%_10%)] dark:to-[hsl(240_10%_8%)] pb-24">
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-[hsl(240_10%_10%/0.9)] backdrop-blur-lg border-b border-purple-100 dark:border-purple-900/40">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-2">
          <Button
            variant="ghost" size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
            className="rounded-2xl"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <BookHeart className="w-5 h-5 text-purple-600 dark:text-purple-300" />
            <h1 className="font-black text-base text-purple-900 dark:text-purple-100">育児日記</h1>
          </div>
          <Button
            size="sm"
            onClick={() => openNew(todayKey)}
            data-testid="button-new-diary"
            className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold"
          >
            <Plus className="w-4 h-4 mr-1" /> 書く
          </Button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4">
        <div className="bg-white dark:bg-[hsl(240_10%_12%)] rounded-3xl p-4 shadow-sm border border-purple-100 dark:border-purple-900/40">
          <div className="flex items-center justify-between mb-3">
            <Button
              variant="ghost" size="icon"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              data-testid="button-prev-month"
              className="rounded-2xl"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="font-black text-purple-900 dark:text-purple-100" data-testid="text-current-month">
              {cursor.getFullYear()}年 {cursor.getMonth() + 1}月
            </div>
            <Button
              variant="ghost" size="icon"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              data-testid="button-next-month"
              className="rounded-2xl"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
              <div
                key={w}
                className={cn(
                  "text-center text-[10px] font-bold py-1",
                  i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : "text-purple-400"
                )}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map(({ date, key }) => {
              if (!date) return <div key={key} className="aspect-square" />;
              const k = ymd(date);
              const dayEntries = entriesByDate.get(k) || [];
              const hasShared = dayEntries.some(e => e.visibility === "shared");
              const hasPrivate = dayEntries.some(e => e.visibility === "private");
              const isToday = k === todayKey;
              const isSelected = k === selectedDate;
              const dow = date.getDay();
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(k)}
                  data-testid={`button-date-${k}`}
                  className={cn(
                    "aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold transition-all",
                    isSelected
                      ? "bg-purple-600 text-white shadow-md"
                      : isToday
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200"
                      : "hover:bg-purple-50 dark:hover:bg-purple-900/20",
                    !isSelected && !isToday && (dow === 0 ? "text-rose-500" : dow === 6 ? "text-sky-500" : "text-slate-700 dark:text-slate-200")
                  )}
                >
                  <span>{date.getDate()}</span>
                  {(hasShared || hasPrivate) && (
                    <div className="flex gap-0.5">
                      {hasShared && (
                        <span className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-white" : "bg-purple-500")} />
                      )}
                      {hasPrivate && (
                        <span className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-white/70" : "bg-rose-400")} />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-3 mt-3 text-[10px] text-purple-500 dark:text-purple-300">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" />共有</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" />自分だけ</span>
          </div>
        </div>

        {selectedDate && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="font-black text-purple-900 dark:text-purple-100" data-testid="text-selected-date">
                {selectedDate.replace(/-/g, "/")} の日記
              </h2>
              <Button
                size="sm" variant="ghost"
                onClick={() => openNew(selectedDate)}
                data-testid="button-add-for-date"
                className="rounded-2xl text-purple-600 dark:text-purple-300 font-bold"
              >
                <Plus className="w-4 h-4 mr-1" /> 追加
              </Button>
            </div>

            {selectedEntries.length === 0 ? (
              <div className="bg-white dark:bg-[hsl(240_10%_12%)] rounded-3xl p-6 text-center border border-dashed border-purple-200 dark:border-purple-900/40">
                <BookHeart className="w-8 h-8 mx-auto text-purple-300 mb-2" />
                <p className="text-sm text-purple-500 dark:text-purple-300">この日の日記はまだありません</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedEntries.map(e => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    isMine={e.userId === userType}
                    onEdit={() => openEdit(e)}
                    onDelete={() => setDeleteTargetId(e.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedDate && !isLoading && entries.length > 0 && (
          <p className="text-center text-xs text-purple-400 mt-4">日付をタップして日記を見る</p>
        )}
      </main>

      <DiaryEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        date={selectedDate || todayKey}
        familyId={familyId}
        entry={editingEntry}
      />

      <AlertDialog open={deleteTargetId != null} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <AlertDialogContent className="rounded-3xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>この日記を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>削除すると元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl" data-testid="button-cancel-delete">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-rose-500 hover:bg-rose-600"
              onClick={() => deleteTargetId != null && deleteMutation.mutate(deleteTargetId)}
              data-testid="button-confirm-delete"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EntryCard({
  entry, isMine, onEdit, onDelete,
}: {
  entry: DiaryEntry;
  isMine: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const mood = MOODS.find(m => m.value === entry.mood);
  const weather = WEATHERS.find(w => w.value === entry.weather);
  return (
    <div
      className="bg-white dark:bg-[hsl(240_10%_12%)] rounded-3xl p-4 border border-purple-100 dark:border-purple-900/40 shadow-sm"
      data-testid={`card-entry-${entry.id}`}
    >
      <div className="flex items-center gap-2 mb-2">
        {entry.visibility === "private" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full">
            <Lock className="w-3 h-3" /> 自分だけ
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full">
            <Users className="w-3 h-3" /> 共有
          </span>
        )}
        {mood && (
          <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", mood.color)}>
            <mood.icon className="w-3 h-3" /> {mood.label}
          </span>
        )}
        {weather && (
          <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", weather.color)}>
            <weather.icon className="w-3 h-3" /> {weather.label}
          </span>
        )}
      </div>

      {entry.title && (
        <h3 className="font-black text-sm text-slate-800 dark:text-slate-100 mb-1" data-testid={`text-title-${entry.id}`}>
          {entry.title}
        </h3>
      )}
      {entry.content && (
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed" data-testid={`text-content-${entry.id}`}>
          {entry.content}
        </p>
      )}

      {entry.images && entry.images.length > 0 && (
        <div className={cn(
          "mt-3 grid gap-2",
          entry.images.length === 1 ? "grid-cols-1" : "grid-cols-3"
        )}>
          {entry.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="w-full aspect-square object-cover rounded-2xl border border-purple-100 dark:border-purple-900/40"
              data-testid={`img-entry-${entry.id}-${i}`}
            />
          ))}
        </div>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {entry.tags.map(t => (
            <span key={t} className="text-[10px] font-bold text-purple-500 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full">
              #{t}
            </span>
          ))}
        </div>
      )}

      {isMine && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-purple-50 dark:border-purple-900/40">
          <Button
            size="sm" variant="ghost"
            onClick={onEdit}
            data-testid={`button-edit-${entry.id}`}
            className="rounded-2xl flex-1 text-purple-600 dark:text-purple-300 font-bold"
          >
            <Pencil className="w-3.5 h-3.5 mr-1" /> 編集
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={onDelete}
            data-testid={`button-delete-${entry.id}`}
            className="rounded-2xl flex-1 text-rose-500 font-bold hover:text-rose-600"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> 削除
          </Button>
        </div>
      )}
    </div>
  );
}

function DiaryEditor({
  open, onOpenChange, date, familyId, entry,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  date: string;
  familyId: string;
  entry: DiaryEntry | null;
}) {
  const { toast } = useToast();
  const userType = localStorage.getItem("userType") || "papa";
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [weather, setWeather] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"shared" | "private">("shared");
  const [entryDate, setEntryDate] = useState(date);

  // reset on open
  useMemo(() => {
    if (open) {
      setTitle(entry?.title || "");
      setContent(entry?.content || "");
      setMood(entry?.mood ?? null);
      setWeather(entry?.weather ?? null);
      setTags(entry?.tags || []);
      setImages(entry?.images || []);
      setVisibility((entry?.visibility as "shared" | "private") || "shared");
      setEntryDate(entry?.date || date);
      setTagInput("");
    }
  }, [open, entry, date]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        familyId, userId: userType, date: entryDate, title, content,
        mood, weather, tags, images, visibility,
      };
      if (entry) {
        return apiRequest("PATCH", `/api/diaries/${entry.id}`, payload);
      }
      return apiRequest("POST", "/api/diaries", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaries", familyId] });
      toast({ title: entry ? "日記を更新しました" : "日記を保存しました" });
      onOpenChange(false);
    },
    onError: () => toast({ title: "保存に失敗しました", variant: "destructive" }),
  });

  const handleAddImage = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remain = 3 - images.length;
    if (remain <= 0) {
      toast({ title: "画像は最大3枚までです", variant: "destructive" });
      return;
    }
    const toAdd = Array.from(files).slice(0, remain);
    try {
      const compressed: string[] = [];
      for (const f of toAdd) {
        compressed.push(await compressImage(f));
      }
      setImages(prev => [...prev, ...compressed]);
    } catch {
      toast({ title: "画像の読み込みに失敗しました", variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t) || tags.length >= 20) { setTagInput(""); return; }
    setTags(prev => [...prev, t]);
    setTagInput("");
  };

  const canSave = (title.trim() || content.trim() || images.length > 0) && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-purple-900 dark:text-purple-100">
            {entry ? "日記を編集" : "新しい日記"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">日付</label>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              data-testid="input-date"
              className="rounded-2xl"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">公開範囲</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility("shared")}
                data-testid="button-visibility-shared"
                className={cn(
                  "rounded-2xl py-2.5 px-3 text-sm font-bold border-2 transition-all flex items-center justify-center gap-1.5",
                  visibility === "shared"
                    ? "bg-purple-100 dark:bg-purple-900/40 border-purple-400 text-purple-700 dark:text-purple-200"
                    : "bg-white dark:bg-[hsl(240_10%_14%)] border-purple-100 dark:border-purple-900/40 text-slate-500"
                )}
              >
                <Users className="w-4 h-4" /> 共有
              </button>
              <button
                type="button"
                onClick={() => setVisibility("private")}
                data-testid="button-visibility-private"
                className={cn(
                  "rounded-2xl py-2.5 px-3 text-sm font-bold border-2 transition-all flex items-center justify-center gap-1.5",
                  visibility === "private"
                    ? "bg-rose-100 dark:bg-rose-900/40 border-rose-400 text-rose-700 dark:text-rose-200"
                    : "bg-white dark:bg-[hsl(240_10%_14%)] border-purple-100 dark:border-purple-900/40 text-slate-500"
                )}
              >
                <Lock className="w-4 h-4" /> 自分だけ
              </button>
            </div>
            {visibility === "private" && (
              <p className="text-[10px] text-rose-500 mt-1">パートナーには存在も表示されません</p>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">タイトル</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="今日のひとこと（任意）"
              maxLength={120}
              data-testid="input-title"
              className="rounded-2xl"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">本文</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="今日のできごとを書いてみよう"
              rows={6}
              maxLength={20000}
              data-testid="input-content"
              className="rounded-2xl"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">気分</label>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMood(mood === m.value ? null : m.value)}
                  data-testid={`button-mood-${m.value}`}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-bold border-2 inline-flex items-center gap-1 transition-all",
                    mood === m.value
                      ? cn("border-current", m.color)
                      : "border-purple-100 dark:border-purple-900/40 text-slate-500"
                  )}
                >
                  <m.icon className="w-3.5 h-3.5" /> {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">天気</label>
            <div className="flex flex-wrap gap-1.5">
              {WEATHERS.map(w => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => setWeather(weather === w.value ? null : w.value)}
                  data-testid={`button-weather-${w.value}`}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-bold border-2 inline-flex items-center gap-1 transition-all",
                    weather === w.value
                      ? cn("border-current", w.color)
                      : "border-purple-100 dark:border-purple-900/40 text-slate-500"
                  )}
                >
                  <w.icon className="w-3.5 h-3.5" /> {w.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">タグ</label>
            <div className="flex gap-2 mb-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="タグを追加"
                maxLength={20}
                data-testid="input-tag"
                className="rounded-2xl"
              />
              <Button type="button" onClick={addTag} variant="outline" className="rounded-2xl" data-testid="button-add-tag">追加</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TAG_PRESETS.filter(p => !tags.includes(p)).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => tags.length < 20 && setTags(prev => [...prev, p])}
                  data-testid={`button-preset-tag-${p}`}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold border border-purple-200 dark:border-purple-900/40 text-purple-500 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                >
                  + {p}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-200 bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded-full">
                    #{t}
                    <button
                      type="button"
                      onClick={() => setTags(prev => prev.filter(x => x !== t))}
                      data-testid={`button-remove-tag-${t}`}
                      className="hover:text-rose-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-purple-600 dark:text-purple-300 mb-1 block">
              写真 ({images.length}/3)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square">
                  <img src={src} alt="" className="w-full h-full object-cover rounded-2xl border border-purple-100 dark:border-purple-900/40" />
                  <button
                    type="button"
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    data-testid={`button-remove-image-${i}`}
                    className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full p-1 shadow-md"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {images.length < 3 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  data-testid="button-add-image"
                  className="aspect-square rounded-2xl border-2 border-dashed border-purple-200 dark:border-purple-900/40 flex flex-col items-center justify-center text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                >
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-[10px] font-bold mt-1">追加</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleAddImage(e.target.files)}
              data-testid="input-file-image"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-editor"
            className="rounded-2xl"
          >
            キャンセル
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
            data-testid="button-save-diary"
            className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold"
          >
            {saveMutation.isPending ? "保存中..." : entry ? "更新する" : "保存する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
