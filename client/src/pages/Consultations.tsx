import { useEffect, useRef, useState, type ReactNode } from "react";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, FileText, MessageCircle, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Consultation, useConsultation, useConsultationCache, useConsultations, useConsultationStatus, writeConsultation } from "@/hooks/use-consultations";

const safeFailure = "通信に失敗しました。内容はそのままです。もう一度お試しください。";
const uuid = () => crypto.randomUUID();
const formatDate = (value: string) => new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-gradient-to-b from-purple-50 via-[#fffdf9] to-pink-50 text-slate-700" style={{ fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif' }}>{children}</div>;
}

function StatusPanel({ type, retry }: { type: "unavailable" | "loggedout" | "error"; retry?: () => void }) {
  const text = type === "unavailable" ? "この機能は現在ご利用いただけません。" : type === "loggedout" ? "相談を利用するにはログインが必要です。" : "通信状態を確認して、もう一度お試しください。";
  return <Shell><main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6 text-center">
    <div className="rounded-[28px] border border-purple-100 bg-white/90 p-7 shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100"><MessageCircle className="h-6 w-6 text-purple-600" /></div>
      <h1 className="text-lg font-black text-purple-900">個別相談</h1><p className="mt-3 text-sm leading-6 text-slate-500">{text}</p>
      {retry && <Button onClick={retry} className="mt-6 rounded-2xl bg-purple-600 font-bold hover:bg-purple-700" data-testid="button-consultations-retry">再読み込み</Button>}
    </div>
  </main></Shell>;
}

function Header({ back }: { back?: string }) {
  return <header className="sticky top-0 z-10 border-b border-purple-100 bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3">
    {back ? <Link href={back} aria-label="相談一覧に戻る" data-testid="link-consultations-back" className="flex h-10 w-10 items-center justify-center rounded-2xl text-purple-700 hover:bg-purple-50"><ArrowLeft className="h-5 w-5" /></Link> : <Link href="/" aria-label="ホームに戻る" data-testid="link-consultations-home" className="flex h-10 w-10 items-center justify-center rounded-2xl text-purple-700 hover:bg-purple-50"><ArrowLeft className="h-5 w-5" /></Link>}
    <div><p className="text-[10px] font-bold tracking-widest text-purple-400">WE IKU CARE</p><h1 className="text-base font-black text-purple-900">個別相談</h1></div>
  </div></header>;
}

function ListPage() {
  const [, setLocation] = useLocation();
  const status = useConsultationStatus();
  const active = Boolean(status.data?.enabled && status.data.authenticated && status.data.eligible && status.data.userId);
  const [offset, setOffset] = useState(0);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const list = useConsultations(status.data?.userId, active, offset);
  const { refreshList, clear } = useConsultationCache();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const createLock = useRef(false);
  const requestRef = useRef<{ title: string; id: string } | null>(null);
  const actorRef = useRef<string | null>(null);
  const displayedUserRef = useRef<string | null | undefined>(undefined);
  const [, refreshIdentity] = useState(0);
  const authenticated = status.data?.authenticated;
  const userId = status.data?.userId;
  actorRef.current = userId || null;
  useEffect(() => { if (authenticated === false) clear(); }, [authenticated, clear]);
  useEffect(() => { clear(); setTitle(""); setError(""); requestRef.current = null; setOffset(0); setConsultations([]); displayedUserRef.current = userId; refreshIdentity(value => value + 1); }, [userId, clear]);
  useEffect(() => {
    if (!list.data) return;
    setConsultations(current => {
      if (offset === 0) return list.data.consultations;
      const known = new Set(current.map(item => item.id));
      return [...current, ...list.data.consultations.filter(item => !known.has(item.id))];
    });
  }, [list.dataUpdatedAt, offset]);
  if (status.isLoading || status.isFetching || displayedUserRef.current !== userId) return <Shell><main className="mx-auto max-w-md px-4 pt-20"><div className="h-24 animate-pulse rounded-3xl bg-purple-100/60" /></main></Shell>;
  if (status.isError) return <StatusPanel type="error" retry={() => status.refetch()} />;
  if (!status.data?.enabled) return <StatusPanel type="unavailable" />;
  if (!status.data.authenticated) return <StatusPanel type="loggedout" />;
  if (!status.data.eligible) return <StatusPanel type="unavailable" />;
  const create = async () => {
    const clean = title.trim();
    if (!clean || createLock.current || status.isFetching) return;
    if (!status.data.csrfToken) { setError(safeFailure); return; }
    const requestActor = actorRef.current;
    createLock.current = true; setError("");
    if (!requestRef.current || requestRef.current.title !== clean) requestRef.current = { title: clean, id: uuid() };
    try {
      const result = await writeConsultation<{ consultation: Consultation }>("/api/consultations", "POST", status.data.csrfToken || "", { title: clean, requestId: requestRef.current.id });
      if (!result?.consultation.id) throw new Error("request_failed");
      if (actorRef.current !== requestActor) return;
      setTitle(""); requestRef.current = null; setOffset(0); setConsultations([]); await refreshList(); setLocation(`/consultations/${result.consultation.id}`);
    } catch (caught) { if (actorRef.current === requestActor) { if (caught instanceof Error && caught.message === "csrf_failed") { clear(); status.refetch(); } setError(safeFailure); } } finally { createLock.current = false; }
  };
  return <Shell><Header /><main className="mx-auto max-w-md px-4 pb-12 pt-5">
    <section className="rounded-[28px] bg-purple-700 p-6 shadow-[0_18px_34px_rgba(112,72,160,.16)]"><p className="text-xs font-bold tracking-wider text-purple-200">PRIVATE CONSULTATION</p><h2 className="mt-2 text-xl font-black" style={{ color: "#fffaf5" }}>相談を整理して、<br />あなたの言葉で残す。</h2><p className="mt-3 text-xs leading-5 text-purple-100" style={{ color: "#f3e8ff" }}>AIによる回答は現在準備中です。相談内容とメモをこの画面で管理できます。</p></section>
    <section className="mt-5 rounded-[26px] border border-purple-100 bg-white p-4 shadow-sm"><label htmlFor="consultation-title" className="text-sm font-bold text-slate-700">新しい相談</label><div className="mt-2 flex gap-2"><Input id="consultation-title" aria-label="相談タイトル" value={title} maxLength={120} onChange={e => { setTitle(e.target.value); if (requestRef.current?.title !== e.target.value.trim()) requestRef.current = null; }} onKeyDown={e => { if (e.key === "Enter") create(); }} placeholder="例：夜の寝かしつけについて" className="rounded-2xl border-purple-100" data-testid="input-consultation-title" /><Button onClick={create} disabled={!title.trim() || status.isFetching} aria-label="相談を作成" className="shrink-0 rounded-2xl bg-purple-600 hover:bg-purple-700" data-testid="button-create-consultation"><Plus className="h-4 w-4" /></Button></div>{error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}</section>
    <div className="mt-7 flex items-center justify-between"><h2 className="text-sm font-black text-purple-900">相談履歴</h2><span className="text-xs text-purple-400">{consultations.length}件</span></div>
    {list.isLoading && consultations.length === 0 ? <div className="mt-3 space-y-3"><div className="h-20 animate-pulse rounded-3xl bg-purple-100/60" /><div className="h-20 animate-pulse rounded-3xl bg-purple-100/60" /></div> : list.isError ? <div role="alert" className="mt-3 rounded-3xl bg-white p-5 text-sm text-slate-500">{safeFailure}<Button variant="ghost" onClick={() => list.refetch()} className="ml-2 px-0 text-purple-700" data-testid="button-list-retry">再試行</Button></div> : !consultations.length ? <div className="mt-3 rounded-3xl border border-dashed border-purple-200 bg-white/70 p-8 text-center"><FileText className="mx-auto h-7 w-7 text-purple-300" /><p className="mt-3 text-sm font-bold text-purple-700">まだ相談はありません</p><p className="mt-1 text-xs text-slate-500">タイトルをつけて、最初の相談を作成しましょう。</p></div> : <div className="mt-3 space-y-3">{consultations.map(item => <Link key={item.id} href={`/consultations/${item.id}`} className="block rounded-3xl border border-purple-100 bg-white p-4 shadow-sm transition-transform hover:-translate-y-0.5" data-testid={`link-consultation-${item.id}`}><p className="font-bold text-slate-800">{item.title}</p><p className="mt-2 text-xs text-purple-400">更新 {formatDate(item.updatedAt)}</p></Link>)}{list.data?.nextOffset !== null && list.data?.nextOffset !== undefined && <Button variant="outline" onClick={() => setOffset(list.data!.nextOffset!)} disabled={list.isFetching} className="w-full rounded-2xl border-purple-200 text-purple-700" data-testid="button-load-more-consultations">{list.isFetching ? "読み込み中" : "過去の相談を読み込む"}</Button>}</div>}
  </main></Shell>;
}

function DetailPage({ id }: { id: string }) {
  const [, setLocation] = useLocation(); const status = useConsultationStatus(); const active = Boolean(status.data?.enabled && status.data.authenticated && status.data.eligible && status.data.userId); const detail = useConsultation(id, status.data?.userId, active); const { refreshDetail, refreshList, clear, resetList } = useConsultationCache();
  const [content, setContent] = useState(""); const [title, setTitle] = useState(""); const [editing, setEditing] = useState(false); const [confirming, setConfirming] = useState(false); const [error, setError] = useState(""); const messageLock = useRef(false); const titleLock = useRef(false); const deleteLock = useRef(false); const messageRequest = useRef<{ content: string; id: string } | null>(null); const actorRef = useRef<string | null>(null);
  const displayedUserRef = useRef<string | null | undefined>(undefined); const [, refreshIdentity] = useState(0);
  useEffect(() => { if (detail.data?.consultation.title && !editing) setTitle(detail.data.consultation.title); }, [detail.data?.consultation.title, editing]);
  const authenticated = status.data?.authenticated;
  actorRef.current = status.data?.userId || null;
  useEffect(() => { if (authenticated === false) clear(); }, [authenticated, clear]);
  useEffect(() => { clear(); setTitle(""); setContent(""); setError(""); setEditing(false); setConfirming(false); messageRequest.current = null; displayedUserRef.current = status.data?.userId; refreshIdentity(value => value + 1); }, [status.data?.userId, clear]);
  if (status.isLoading || status.isFetching || displayedUserRef.current !== status.data?.userId || (active && detail.isLoading)) return <Shell><Header back="/consultations" /><main className="mx-auto max-w-md px-4 pt-5"><div className="h-40 animate-pulse rounded-3xl bg-purple-100/60" /></main></Shell>;
  if (status.isError || detail.isError) return <StatusPanel type="error" retry={() => { status.refetch(); detail.refetch(); }} />;
  if (!status.data?.enabled) return <StatusPanel type="unavailable" />; if (!status.data.authenticated) return <StatusPanel type="loggedout" />; if (!status.data.eligible) return <StatusPanel type="unavailable" />; if (!detail.data) return null;
  const send = async () => { const clean = content.trim(); if (!clean || messageLock.current || status.isFetching) return; if (!status.data.csrfToken) { setError(safeFailure); return; } const requestActor = actorRef.current; messageLock.current = true; setError(""); if (!messageRequest.current || messageRequest.current.content !== clean) messageRequest.current = { content: clean, id: uuid() }; try { await writeConsultation<{ message: unknown }>(`/api/consultations/${encodeURIComponent(id)}/messages`, "POST", status.data.csrfToken, { content: clean, requestId: messageRequest.current.id }); if (actorRef.current !== requestActor) return; setContent(""); messageRequest.current = null; await refreshDetail(id); } catch (caught) { if (actorRef.current === requestActor) { if (caught instanceof Error && caught.message === "csrf_failed") { clear(); status.refetch(); } setError(safeFailure); } } finally { messageLock.current = false; } };
  const saveTitle = async () => { const clean = title.trim(); if (!clean || clean === detail.data.consultation.title || titleLock.current || status.isFetching) { setEditing(false); return; } if (!status.data.csrfToken) { setError(safeFailure); return; } const requestActor = actorRef.current; titleLock.current = true; setError(""); try { await writeConsultation<{ consultation: Consultation }>(`/api/consultations/${encodeURIComponent(id)}`, "PATCH", status.data.csrfToken, { title: clean }); if (actorRef.current !== requestActor) return; resetList(); await refreshDetail(id); setEditing(false); } catch (caught) { if (actorRef.current === requestActor) { if (caught instanceof Error && caught.message === "csrf_failed") { clear(); status.refetch(); } setError(safeFailure); } } finally { titleLock.current = false; } };
  const remove = async () => { if (deleteLock.current || status.isFetching) return; if (!status.data.csrfToken) { setError(safeFailure); setConfirming(false); return; } const requestActor = actorRef.current; deleteLock.current = true; try { await writeConsultation(`/api/consultations/${encodeURIComponent(id)}`, "DELETE", status.data.csrfToken); if (actorRef.current !== requestActor) return; resetList(); await refreshList(); setLocation("/consultations"); } catch (caught) { if (actorRef.current === requestActor) { if (caught instanceof Error && caught.message === "csrf_failed") { clear(); status.refetch(); } setError(safeFailure); setConfirming(false); } } finally { deleteLock.current = false; } };
  return <Shell><Header back="/consultations" /><main className="mx-auto max-w-md px-4 pb-10 pt-5"><section className="rounded-[28px] border border-purple-100 bg-white p-5 shadow-sm"><div className="flex gap-2">{editing ? <Input aria-label="相談タイトルを変更" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} className="rounded-xl" data-testid="input-edit-consultation-title" /> : <h2 className="flex-1 text-lg font-black text-purple-900">{detail.data.consultation.title}</h2>}<Button variant="ghost" size="icon" aria-label={editing ? "タイトルの変更を保存" : "相談タイトルを変更"} onClick={editing ? saveTitle : () => setEditing(true)} className="rounded-xl text-purple-600" data-testid="button-edit-consultation-title"><Pencil className="h-4 w-4" /></Button></div><p className="mt-2 text-xs text-purple-400">作成 {formatDate(detail.data.consultation.createdAt)}</p></section>
    <section className="mt-5"><h3 className="mb-3 text-sm font-black text-purple-900">メモ</h3><div className="space-y-3">{!detail.data.messages.length ? <div className="rounded-3xl border border-dashed border-purple-200 bg-white/60 p-7 text-center text-sm text-slate-500">相談内容を入力してください。</div> : detail.data.messages.map(message => <article key={message.id} className="rounded-3xl border border-purple-100 bg-white p-4 shadow-sm" data-testid={`consultation-message-${message.id}`}><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{message.content}</p><p className="mt-3 text-[11px] text-purple-400">{formatDate(message.createdAt)}</p></article>)}</div></section>
    {detail.data.messages.length >= 200 ? <section className="mt-5 rounded-[26px] border border-purple-100 bg-purple-50 p-5 text-center"><p className="text-sm font-bold text-purple-900">この相談のメモは200件に達しました</p><p className="mt-1 text-xs text-purple-500">これまでのメモはすべて表示されています。</p></section> : <section className="mt-5 rounded-[26px] bg-purple-50 p-4"><label htmlFor="consultation-message" className="text-sm font-bold text-purple-900">相談内容を追加</label><Textarea id="consultation-message" aria-label="相談内容" value={content} maxLength={10000} onChange={e => { setContent(e.target.value); if (messageRequest.current?.content !== e.target.value.trim()) messageRequest.current = null; }} placeholder="今の状況や気になっていることを書いてください" className="mt-2 min-h-32 rounded-2xl border-purple-100 bg-white" data-testid="input-consultation-message" /><div className="mt-2 flex justify-between"><span className="text-[11px] text-purple-400">{content.length}/10000</span><Button onClick={send} disabled={!content.trim()} className="rounded-2xl bg-purple-600 hover:bg-purple-700" data-testid="button-send-consultation-message"><Send className="mr-1 h-4 w-4" />追加</Button></div>{error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}</section>}
    <p className="mt-7 text-center text-xs font-bold text-purple-500">AI回答はまだ利用できません</p><Button variant="ghost" onClick={() => setConfirming(true)} className="mx-auto mt-3 flex rounded-2xl text-rose-600 hover:bg-rose-50 hover:text-rose-700" data-testid="button-delete-consultation"><Trash2 className="mr-1 h-4 w-4" />この相談を削除</Button>
    <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent className="max-w-sm rounded-3xl"><AlertDialogHeader><AlertDialogTitle>相談を削除しますか？</AlertDialogTitle><AlertDialogDescription>相談とすべてのメモが削除され、元に戻せません。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="rounded-2xl" data-testid="button-cancel-delete-consultation">キャンセル</AlertDialogCancel><AlertDialogAction onClick={remove} className="rounded-2xl bg-rose-600 hover:bg-rose-700" data-testid="button-confirm-delete-consultation">削除する</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main></Shell>;
}

export default function Consultations() {
  const [, params] = useRoute("/consultations/:id");
  return params?.id ? <DetailPage id={params.id} /> : <ListPage />;
}