import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceSearchResult } from "../../shared/evidence";
import { AnswerPanel } from "./AnswerPanel";
import { ageNotice } from "./flow";
import type { ConsultationInput, ConsultationResponse, EvidenceGroup, HealthAnswer, TargetChoice } from "./contract";
import "./answer-styles.css";

type Child = { id: string; years: string; months: string };
const targets: { value: TargetChoice; label: string }[] = [{ value: "child", label: "子どもについて" }, { value: "caregiver", label: "保護者自身について" }, { value: "both", label: "両方" }, { value: "unknown", label: "まだ分からない" }];
const labels: Record<string, string> = { matched: "入力した条件に適合する資料が見つかりました", unverified: "資料は見つかりましたが、適用条件に未確認事項があります", no_matching: "今回の収録資料では、指定条件に合う資料が見つかりません", no_vocabulary: "検索語に対応できず、資料の有無を判断できません", incomplete: "検索が未完了です（確定結果ではありません）" };

function parseAge(value: string) { return value === "" ? null : Number(value); }
function policyText(policy: unknown) { return JSON.stringify(policy); }
function matchText(value: "matched" | "mismatched" | "unverified") { return value === "matched" ? "適合" : value === "unverified" ? "未確認" : "不適合"; }
function scopedAgeText(policy: EvidenceSearchResult["section"]["resolvedApplicabilityPolicy"]["weiku"]["age"]) {
  if (policy.mode !== "specific") return "未確認";
  return policy.scope === "all" ? "全年齢" : `${policy.minMonths}〜${policy.maxMonths}か月`;
}
function scopedTargetText(policy: EvidenceSearchResult["section"]["resolvedApplicabilityPolicy"]["weiku"]["target"]) {
  return policy.mode === "specific" ? policy.values.map(value => value === "child" ? "子ども" : "保護者").join("・") : "未確認";
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [target, setTarget] = useState<TargetChoice>("unknown");
  const [children, setChildren] = useState<Child[]>([{ id: "child1", years: "", months: "" }]);
  const [confirmed, setConfirmed] = useState(false);
  const [conflictAck, setConflictAck] = useState(false);
  const [response, setResponse] = useState<ConsultationResponse | null>(null);
  const [health, setHealth] = useState<Record<string, Record<string, HealthAnswer>>>({});
  const [promptGroups, setPromptGroups] = useState<EvidenceGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const [answerRevision, setAnswerRevision] = useState(0);
  const request = useRef(0); const controller = useRef<AbortController | null>(null);
  const nextChildNumber = useRef(2);
  const notice = useMemo(() => ageNotice({ question, children: target === "child" || target === "both" ? children.map(({ id, years, months }) => ({ id, years: parseAge(years), months: parseAge(months) })) : [] }), [question, children, target]);
  const invalidate = (clearFollowups = true) => { request.current += 1; controller.current?.abort(); setLoading(false); setResponse(null); setTransportError(false); setConfirmed(false); setConflictAck(false); setAnswerRevision(value => value + 1); if (clearFollowups) { setPromptGroups([]); setHealth({}); } };
  const clearResultsOnly = () => { request.current += 1; controller.current?.abort(); setLoading(false); setResponse(null); setTransportError(false); setConfirmed(false); setAnswerRevision(value => value + 1); };
  const clearResultsKeepingConfirmation = () => { request.current += 1; controller.current?.abort(); setLoading(false); setResponse(null); setTransportError(false); setAnswerRevision(value => value + 1); };
  useEffect(() => () => controller.current?.abort(), []);
  const setChild = (id: string, field: "years" | "months", value: string) => { invalidate(); if (value !== "" && (!/^\d{1,3}$/.test(value) || Number(value) > (field === "months" ? 11 : 100))) return; setChildren(old => old.map(c => c.id === id ? { ...c, [field]: value } : c)); };
  const changeQuestion = (value: string) => { invalidate(); setQuestion(value); };
  const addChild = () => { if (children.length < 4) { invalidate(); const id = `child${nextChildNumber.current}`; nextChildNumber.current += 1; setChildren(old => [...old, { id, years: "", months: "" }]); } };
  const removeChild = (id: string) => { if (children.length > 1) { invalidate(); setChildren(old => old.filter(child => child.id !== id)); } };
  const canSubmit = question.trim().length > 0 && confirmed && (!notice.conflict || conflictAck);
  const currentConsultation = useMemo<ConsultationInput>(() => ({
    question: question.trim(),
    target,
    children: target === "child" || target === "both"
      ? children.map(({ id, years, months }) => ({ id, years: parseAge(years), months: parseAge(months) }))
      : [],
    health,
    confirmed,
    ageConflictAcknowledged: conflictAck,
  }), [question, target, children, health, confirmed, conflictAck]);
  const submit = async () => {
    if (!canSubmit) return;
    const revision = ++request.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setTransportError(false);
    const payload: ConsultationInput = currentConsultation;
    try {
      const res = await fetch("/api/prototype/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: abort.signal });
      if (!res.ok) throw new Error("request");
      const data = await res.json() as ConsultationResponse;
      if (revision === request.current) { setResponse(data); setPromptGroups(data.groups.filter(g => g.healthPrompts.length)); setHealth(current => { const next = { ...current }; data.groups.forEach(g => { if (g.healthPrompts.length) next[g.id] ??= {}; }); return next; }); setAnswerRevision(value => value + 1); }
    } catch (error) { if ((error as Error).name !== "AbortError" && revision === request.current) setTransportError(true); }
    finally { if (revision === request.current) setLoading(false); }
  };
  const clear = () => { invalidate(); setQuestion(""); setTarget("unknown"); setChildren([{ id:`child${nextChildNumber.current}`, years:"", months:"" }]); nextChildNumber.current += 1; setHealth({}); setPromptGroups([]); };
  const answer = (group: string, key: string, value: HealthAnswer) => { clearResultsOnly(); setHealth(old => ({ ...old, [group]: { ...old[group], [key]: value } })); };
  return <main className="shell">
    <header className="mast"><div><p className="eyebrow">根拠確認のための非公開テスト</p><p className="brand">We育</p></div><button className="clear" onClick={clear}>入力と表示を消去</button></header>
    <section className="intro"><h1>答えを急がず、<br />もとの根拠を確認する。</h1><p className="lead">これは相談内容に関わる資料を探すための試作画面です。AIによる助言・診断・承認は行いません。入力内容はこのブラウザを開いている間だけ保持されます。</p></section>
    <div className="notice"><strong>非公開・テスト専用</strong>この画面は公開サービスではありません。個人を特定する情報やお子さまの名前は入力しないでください。</div>
    <section className="form" aria-label="根拠確認フォーム">
      <fieldset className="step"><legend>1. 確認したいこと</legend><label htmlFor="question">質問</label><textarea id="question" value={question} onChange={e => changeQuestion(e.target.value)} placeholder="例：夜間に何度も目が覚めることについて、参照できる資料を確認したい" /></fieldset>
      <fieldset className="step"><legend>2. 誰についてですか</legend><div className="options">{targets.map(t => <label className="choice" key={t.value}><input type="radio" name="target" checked={target === t.value} onChange={() => { invalidate(); setTarget(t.value); }} />{t.label}</label>)}</div></fieldset>
      {(target === "child" || target === "both") && <fieldset className="step"><legend>3. 年齢（必要な場合のみ）</legend><p className="quiet">年齢が不明な場合は空欄のままにしてください。0を初期値として扱いません。</p><div className="children">{children.map((child, i) => <div className="child" key={child.id}><div className="child-head"><span>子ども{i + 1}</span>{children.length > 1 && <button type="button" className="clear" onClick={() => removeChild(child.id)}>この子どもを削除</button>}</div><div className="age-grid"><div><label htmlFor={`${child.id}-years`}>年</label><input id={`${child.id}-years`} inputMode="numeric" type="number" min="0" max="100" value={child.years} onChange={e => setChild(child.id, "years", e.target.value)} /></div><div><label htmlFor={`${child.id}-months`}>か月</label><input id={`${child.id}-months`} inputMode="numeric" type="number" min="0" max="11" value={child.months} onChange={e => setChild(child.id, "months", e.target.value)} /></div></div></div>)}</div>{children.length < 4 && <button type="button" className="clear" onClick={addChild}>子どもを追加（最大4人）</button>}{notice.message && <div className="warn">{notice.message}<label className="check"><input type="checkbox" checked={conflictAck} onChange={e => { clearResultsKeepingConfirmation(); setConflictAck(e.target.checked); }} />年齢候補の違いを確認しました</label></div>}</fieldset>}
      <fieldset className="step"><legend>4. 内容を確認して検索</legend><div className="confirmation"><p><b>質問：</b>{question.trim() || "未入力"}</p><p><b>対象：</b>{targets.find(t => t.value === target)?.label}</p>{(target === "child" || target === "both") && <p><b>年齢：</b>{children.map((c, i) => `子ども${i + 1} ${c.years === "" && c.months === "" ? "不明" : `${c.years === "" ? "不明" : c.years + "歳"} ${c.months === "" ? "不明" : c.months + "か月"}`}`).join(" ／ ")}</p>}{target === "unknown" && <p><b>年齢：</b>対象未確認のため年齢は使用しません</p>}</div><label className="check"><input type="checkbox" checked={confirmed} onChange={e => { clearResultsOnly(); setConfirmed(e.target.checked); }} />この内容で、元の資料を確認することを理解しました</label><div className="actions"><button type="button" className="primary" onClick={submit} disabled={!canSubmit || loading}>{loading ? "確認しています…" : "根拠を確認する"}</button><span className="status" aria-live="polite">{!question.trim() ? "質問を入力してください" : !confirmed ? "確認にチェックしてください" : notice.conflict && !conflictAck ? "年齢候補の確認が必要です" : ""}</span></div></fieldset>
    </section>
    <AnswerPanel consultation={currentConsultation} formRevision={answerRevision} />
    {transportError && <div className="transport" role="alert">通信に失敗したため、資料の確認を完了できませんでした。内容は保存されていません。時間をおいてもう一度お試しください。<br /><button className="retry" onClick={submit}>もう一度試す</button></div>}
    {response && <Results response={response} health={health} onAnswer={answer} />}
    {!response && promptGroups.length > 0 && <section className="results"><h2>追加の確認を反映する</h2><p className="quiet">回答を変更したため、前の検索結果は表示していません。内容を確認して、もう一度根拠を確認してください。</p>{promptGroups.map(group => <HealthPrompts key={group.id} group={group} answers={health[group.id] ?? {}} onAnswer={answer} />)}</section>}
  </main>;
}

function Results({ response, health, onAnswer }: { response: ConsultationResponse; health: Record<string, Record<string, HealthAnswer>>; onAnswer: (group: string, key: string, value: HealthAnswer) => void }) {
  return <section className="results" aria-live="polite"><h2>{labels[response.state]}</h2><p className="quiet">{response.disclaimer}</p>{response.ageNotice.message && <div className="warn">{response.ageNotice.message}</div>}{response.expansionNotice && <div className="notice">{response.expansionNotice}</div>}{response.groups.map(group => <Group key={group.id} group={group} answers={health[group.id] ?? {}} onAnswer={onAnswer} />)}</section>;
}
function Group({ group, answers, onAnswer }: { group: EvidenceGroup; answers: Record<string, HealthAnswer>; onAnswer: (group: string, key: string, value: HealthAnswer) => void }) {
  return <article className="group"><h3>{group.label}</h3><span className={`state ${group.state}`}>{labels[group.state]}</span>{group.diagnostics.map((d, i) => <p className="diagnostic" key={i}>{d}</p>)}{group.healthPrompts.length > 0 && <HealthPrompts group={group} answers={answers} onAnswer={onAnswer} />}{group.results.map((item, i) => <EvidenceCard item={item} key={i} />)}</article>;
}
function EvidenceCard({ item }: { item: EvidenceSearchResult }) {
  return <article className="evidence">
    <h4>{item.title}</h4>
    <p>{item.originalText}</p>
    <p><b>原資料：</b><a href={item.citation.originalUrl} target="_blank" rel="noreferrer">{item.citation.title}</a></p>
    <p><b>発行元：</b>{item.citation.publisher}　<b>原文言語：</b>{item.citation.language}</p>
    <p><b>版：</b>{item.citation.version}　<b>掲載箇所：</b>{item.sourceLocation}</p>
    <details><summary>資料の適用条件・確認状況</summary>
      <p>対象：{matchText(item.applicability.target)}／年齢：{matchText(item.applicability.age)}／地域：{matchText(item.applicability.region)}／条件：{matchText(item.applicability.conditions)}／日本での適用：{matchText(item.applicability.japan)}</p>
      <p>この節の対象：{scopedTargetText(item.section.resolvedApplicabilityPolicy.weiku.target)}／この節の年齢：{scopedAgeText(item.section.resolvedApplicabilityPolicy.weiku.age)}</p>
      <p>資料の年齢情報：{item.source.age.scope === "unknown" ? "未確認" : item.source.age.scope === "all" ? "全年齢" : `${item.source.age.minMonths}〜${item.source.age.maxMonths}か月`}</p>
      <p>資料の地域情報：{item.source.regions.scope === "unknown" ? "未確認" : item.source.regions.scope === "all" ? "指定なし" : item.source.regions.values.join("、")}</p>
      <p>資料の条件情報：{item.source.conditions.scope === "unknown" ? "未確認" : item.source.conditions.scope === "all" ? "指定なし" : item.source.conditions.values.join("、")}　除外：{item.source.conditions.exceptions.join("、") || "なし"}</p>
      <p>文書ポリシー：{policyText(item.source.applicabilityPolicy)}</p>
      <p>節ポリシー：{policyText(item.section.applicabilityPolicy)}　適用済み：{policyText(item.section.resolvedApplicabilityPolicy)}</p>
    </details>
    <details><summary>注記・出典の利用条件</summary>
      <p>節の見出し：{item.section.heading ?? "なし"}／節の注記：{item.section.notes ?? "なし"}</p>
      <p>テスト専用資料：{item.source.testOnly ? "はい" : "いいえ"}／資料種別：{item.source.documentType}／著者：{item.source.authors.join("、") || "なし"}／外部識別子：{item.source.externalIdentifier ?? "なし"}</p>
      <p>公表日：{item.source.publishedOn ?? "なし"}／改訂日：{item.source.revisedOn ?? "なし"}／採用審査側の利用条件記録：{item.source.usageTerms ?? "未設定"}</p>
      <p>資料ポリシーの利用条件：{item.source.applicabilityPolicy.usage.mode === "specific" ? item.source.applicabilityPolicy.usage.terms ?? "未確認" : "未確認"}／例外：{item.source.applicabilityPolicy.usage.exceptions.join("、") || "なし"}</p>
      <p>確実性：{item.source.certainty.level ?? "未記録"}／評価法：{item.source.certainty.assessmentMethod ?? "未記録"}／評価出典：{item.source.certainty.assessmentSource ?? "未記録"}</p>
      <p>手動確認：{item.source.review.manualReviewed ? "済み" : "未確認"}／確認者：{item.source.review.reviewerName ?? "未記録"}／確認日：{item.source.review.reviewedAt ?? "未記録"}／採用理由：{item.source.review.adoptionReason ?? "未記録"}</p>
    </details>
    {item.requiredContext.length > 0 && <details><summary>一緒に確認が必要な原文箇所</summary>{item.requiredContext.map(context => <section key={context.sectionId}><p><b>{context.role}：{context.citation.title}</b>（{context.sourceLocation}）</p><p>{context.originalText}</p><p>発行元：{context.citation.publisher}／原文言語：{context.citation.language}／版：{context.citation.version}</p><p>原資料：<a href={context.citation.originalUrl} target="_blank" rel="noreferrer">{context.citation.originalUrl}</a></p><p>注記：{context.notes ?? "なし"}／節種別：{context.section.type}／節見出し：{context.section.heading ?? "なし"}／節の注記：{context.section.notes ?? "なし"}</p><p>節ポリシー：{policyText(context.section.applicabilityPolicy)}　適用済み：{policyText(context.section.resolvedApplicabilityPolicy)}</p></section>)}</details>}
  </article>;
}
function HealthPrompts({ group, answers, onAnswer }: { group: EvidenceGroup; answers: Record<string, HealthAnswer>; onAnswer: (group: string, key: string, value: HealthAnswer) => void }) {
  return <section className="health"><h4>{group.label}：資料を絞るための確認</h4>{group.healthPrompts.map(prompt => <div key={prompt.key}><p><b>{prompt.label}</b><br />{prompt.explanation}</p><p className="quiet">現在の回答：{answers[prompt.key] === "present" ? "ある" : answers[prompt.key] === "absent" ? "ない" : "未回答／分からない"}</p><div className="answer-set">{([{ value:"present", label:"ある" }, { value:"absent", label:"ない" }, { value:"unknown", label:"分からない" }] as const).map(x => <label key={x.value}><input type="radio" name={`${group.id}-${prompt.key}`} checked={answers[prompt.key] === x.value} onChange={() => onAnswer(group.id, prompt.key, x.value)} /> {x.label}</label>)}</div></div>)}</section>;
}