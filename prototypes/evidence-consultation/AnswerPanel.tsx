import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceSearchResult } from "../../shared/evidence";
import type { ConsultationInput } from "./contract";
import type {
  AnswerGroup,
  AnswerRequest,
  AnswerResponse,
  EvidenceReference,
  UrgentConcern,
} from "./answer-contract";

type AnswerPanelProps = {
  consultation: ConsultationInput;
  formRevision: number;
};

const urgencyChoices: Array<{ value: UrgentConcern; label: string }> = [
  { value: "yes", label: "はい" },
  { value: "no", label: "いいえ" },
  { value: "unknown", label: "分からない" },
];

function referenceKey(reference: EvidenceReference) {
  return `${reference.sourceId}:${reference.versionId}:${reference.sectionId}`;
}

function sourceAnchor(reference: EvidenceReference) {
  return `answer-source-${reference.sourceId}-${reference.versionId}-${reference.sectionId}`;
}

function sourceReference(source: EvidenceSearchResult): EvidenceReference {
  return {
    sourceId: source.sourceId,
    versionId: source.versionId,
    sectionId: source.sectionId,
  };
}

function ageText(source: EvidenceSearchResult) {
  const { age } = source.source;
  if (age.scope === "all") return "全年齢";
  if (age.scope === "range") return `${age.minMonths}〜${age.maxMonths}か月`;
  return "未確認";
}

function listText(values: string[]) {
  return values.length > 0 ? values.join("、") : "記録なし";
}

function policyModeText(mode: "unknown" | "inherit" | "specific") {
  if (mode === "specific") return "記録あり";
  if (mode === "inherit") return "上位記録を継承";
  return "未確認";
}

function researchAgeText(source: EvidenceSearchResult) {
  const age = source.section.resolvedApplicabilityPolicy.research.participantAge;
  if (age.mode !== "specific") return policyModeText(age.mode);
  if (age.scope === "all") return "全年齢";
  if (age.scope === "mean") return `平均 ${age.meanMonths}か月`;
  return `${age.minMonths}〜${age.maxMonths}か月`;
}

function researchRegionText(source: EvidenceSearchResult) {
  const regions = source.section.resolvedApplicabilityPolicy.research.regions;
  if (regions.mode !== "specific") return policyModeText(regions.mode);
  return regions.scope === "all" ? "指定なし" : listText(regions.values);
}

function sourceClassification(documentType: string) {
  // These are the exact types recorded for the four current sources. A
  // publisher name, URL, or other surrounding metadata never changes this.
  if (documentType === "Systematic review and meta-analysis") return "研究資料";
  if (documentType === "研究を参照した公的支援ガイド" || documentType === "公的睡眠ガイド") {
    return "ガイド";
  }
  return "分類未確認";
}

function isAnswerResponse(value: unknown): value is AnswerResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<AnswerResponse>;
  return typeof response.requestId === "string"
    && response.mode === "offline"
    && response.modelUsed === false
    && ["checked", "emergency_stop", "cancelled", "rejected"].includes(response.status ?? "")
    && Array.isArray(response.notices)
    && response.notices.every((notice) => typeof notice === "string")
    && Array.isArray(response.groups)
    && response.groups.every((group) => isAnswerGroup(group));
}

function isAnswerGroup(value: unknown): value is AnswerGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<AnswerGroup>;
  return typeof group.id === "string"
    && typeof group.label === "string"
    && ["needs_confirmation", "insufficient", "incomplete", "connection_unconfigured", "rejected"].includes(group.status ?? "")
    && typeof group.message === "string"
    && Array.isArray(group.questions)
    && group.questions.every((question) => typeof question === "string")
    && Array.isArray(group.claims)
    // An offline prototype must never accept a model-style answer, even if a
    // response has a superficially valid shape.
    && group.claims.length === 0
    && Array.isArray(group.sources)
    && group.sources.every((source) => Boolean(source) && typeof source === "object");
}

/**
 * A local-only condition checker. It intentionally labels all returned
 * questions as system notices and never represents them as an AI answer.
 */
export function AnswerPanel({ consultation, formRevision }: AnswerPanelProps) {
  const [urgentConcern, setUrgentConcern] = useState<UrgentConcern>("unknown");
  const [response, setResponse] = useState<AnswerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const requestRevision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const canCheck = consultation.confirmed && consultation.question.trim().length > 0;

  const clearAnswer = (wasCancelled = false) => {
    requestRevision.current += 1;
    inFlight.current = false;
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
    setResponse(null);
    setTransportError(false);
    setCancelled(wasCancelled);
  };

  // The parent increments this revision for every consultation, health, or
  // confirmation edit, so an older response can never be shown for new input.
  useEffect(() => {
    clearAnswer();
    setUrgentConcern("unknown");
  }, [formRevision]);

  useEffect(() => () => {
    requestRevision.current += 1;
    inFlight.current = false;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const requestBody = useMemo(() => consultation, [
    consultation.question,
    consultation.target,
    consultation.children,
    consultation.health,
    consultation.confirmed,
    consultation.ageConflictAcknowledged,
  ]);

  const checkConditions = async () => {
    // State updates are not synchronous, so this ref is the duplicate guard
    // before the first await as well as while React is re-rendering.
    if (!canCheck || inFlight.current) return;
    if (typeof crypto.randomUUID !== "function") {
      setTransportError(true);
      return;
    }

    inFlight.current = true;
    const revision = ++requestRevision.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request: AnswerRequest = {
      requestId: crypto.randomUUID(),
      consultation: requestBody,
      urgentConcern,
    };

    setLoading(true);
    setResponse(null);
    setTransportError(false);
    setCancelled(false);
    try {
      const result = await fetch("/api/prototype/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      if (!result.ok) throw new Error("answer-request");
      const data: unknown = await result.json();
      if (!isAnswerResponse(data)
        || data.requestId !== request.requestId
        || (urgentConcern !== "no" && data.status !== "emergency_stop")) {
        throw new Error("invalid-answer-response");
      }
      if (revision === requestRevision.current) setResponse(data);
    } catch (error) {
      if ((error as Error).name !== "AbortError" && revision === requestRevision.current) {
        setTransportError(true);
      }
    } finally {
      if (revision === requestRevision.current) {
        inFlight.current = false;
        controller.current = null;
        setLoading(false);
      }
    }
  };

  const changeUrgency = (value: UrgentConcern) => {
    clearAnswer();
    setUrgentConcern(value);
  };

  return (
    <section className="answer-panel" aria-labelledby="answer-panel-title">
      <div className="answer-panel__heading">
        <p className="answer-panel__eyebrow">実モデル未接続・通信なし／AI回答はまだ生成しません</p>
        <h2 id="answer-panel-title">回答条件の確認</h2>
        <p>現在は外部サービスへの送信を行わず、実モデルにも接続しません。</p>
      </div>

      <div className="answer-panel__boundary">
        <p><b>現在：</b>外部AIへの送信、保存、履歴作成、研究参加の同意取得は行いません。</p>
        <p><b>今後の接続を検討する場合：</b>目的に必要な最小限のデータを別途示し、研究参加・同意の手続きとは分けて扱います。ここで研究参加への同意を求めることはありません。</p>
        <details className="answer-panel__planned-data">
          <summary>外部送信予定項目（将来の接続時のみ）</summary>
          <p>将来、人による確認を経て外部接続を検討する場合に限り、目的に必要な最小限の項目として次を検討します。</p>
          <ul>
            <li>質問文</li>
            <li>本人が確認した対象・年齢・健康に関する回答</li>
            <li>サーバーが照合に用いる原文と必須文脈</li>
            <li>sourceId、versionId、sectionId、および資料に記録された条件・例外・不確実性</li>
          </ul>
          <p>家族ID、家族員ID、セッションID、履歴、育児記録、確認者の個人情報は送信対象に含めません。資料を指すsourceId等は照合のための識別子であり、ここでは送信候補として扱います。</p>
          <p><b>質問文には個人情報が含まれる可能性があります。</b>将来外部に送信する前には人による確認が必要です。自動匿名化を行う、または匿名化できることを保証しません。</p>
        </details>
      </div>

      <fieldset className="answer-panel__urgency">
        <legend>緊急の心配について</legend>
        <p>この確認は緊急時の振り分けや安全の保証を行うものではありません。「はい」または「分からない」の場合は、サーバー側で回答条件の確認を停止します。</p>
        <div className="answer-panel__choices">
          {urgencyChoices.map((choice) => (
            <label key={choice.value}>
              <input
                type="radio"
                name="urgent-concern"
                checked={urgentConcern === choice.value}
                onChange={() => changeUrgency(choice.value)}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="answer-panel__actions">
        <button
          type="button"
          className="answer-panel__primary"
          onClick={checkConditions}
          disabled={!canCheck || loading}
        >
          {loading ? "回答条件を確認しています…" : "通信なしで回答条件を確認"}
        </button>
        {loading && <button type="button" className="answer-panel__cancel" onClick={() => clearAnswer(true)}>確認を取り消す</button>}
        <span className="answer-panel__status" aria-live="polite">
          {!consultation.question.trim()
            ? "先に質問を入力してください"
            : !consultation.confirmed
              ? "上の内容確認にチェックしてください"
              : cancelled
                ? "確認を取り消しました"
                : ""}
        </span>
      </div>

      {transportError && (
        <div className="answer-panel__error" role="alert">
          回答条件の確認を完了できませんでした。内容は保存されていません。
          <button type="button" onClick={checkConditions} disabled={!canCheck || loading}>もう一度確認する</button>
        </div>
      )}

      {response && <AnswerResult response={response} />}
    </section>
  );
}

function AnswerResult({ response }: { response: AnswerResponse }) {
  const stopped = response.status !== "checked";
  return (
    <section className="answer-result" aria-live="polite">
      <h3>{stopped ? "回答条件の確認を停止しました" : "回答条件の確認結果"}</h3>
      {response.notices.map((notice, index) => <p className="answer-result__notice" key={`${notice}-${index}`}>{notice}</p>)}
      {stopped
        ? <p className="answer-result__stop">AI回答は生成していません。回答条件が整うまで、説明・提案・資料は表示しません。</p>
        : response.groups.map((group) => <AnswerGroupView group={group} key={group.id} />)}
    </section>
  );
}

function AnswerGroupView({ group }: { group: AnswerGroup }) {
  const sources = group.sources;
  return (
    <article className="answer-group">
      <h4>{group.label}</h4>
      <p className="answer-group__message">{group.message}</p>

      {group.questions.length > 0 && (
        <section className="answer-questions">
          <h5>システムによる確認案内</h5>
          <p>この項目はAIの回答ではありません。</p>
          <ul>{group.questions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}</ul>
        </section>
      )}

      {sources.length > 0 && (
        <section className="answer-sources">
          <h5>{group.label}の資料</h5>
          <p>資料はこのグループ内でのみ示します。別の子ども・保護者の資料とまとめません。</p>
          {sources.map((source) => <SourceViewer key={referenceKey(sourceReference(source))} source={source} groupId={group.id} />)}
        </section>
      )}
    </article>
  );
}

function SourceViewer({ source, groupId }: { source: EvidenceSearchResult; groupId: string }) {
  const reference = sourceReference(source);
  const policy = source.section.resolvedApplicabilityPolicy;
  return (
    <article className="answer-source" id={`${encodeURIComponent(groupId)}-${sourceAnchor(reference)}`}>
      <h6>{source.title}</h6>
      <p className="answer-source__ids">sourceId: {source.sourceId}<br />versionId: {source.versionId}<br />sectionId: {source.sectionId}</p>
      <p><b>原文：</b>{source.originalText}</p>
      <p><b>原資料：</b><a href={source.citation.originalUrl} target="_blank" rel="noreferrer">{source.citation.title}</a></p>
      <p><b>版：</b>{source.citation.version}　<b>掲載箇所：</b>{source.sourceLocation}</p>
      <details>
        <summary>資料種別・適用条件・不確実性</summary>
        <p><b>資料種別（原記録）：</b>{source.source.documentType}</p>
        <p><b>研究・ガイドの区別：</b>{sourceClassification(source.source.documentType)}（上の資料種別との完全一致でのみ表示。発行元だけからは分類しません。）</p>
        <p><b>対象：</b>{policyModeText(policy.weiku.target.mode)} {policy.weiku.target.values.join("・") || "記録なし"}　<b>年齢：</b>{ageText(source)}</p>
        <p><b>条件：</b>{listText(source.source.conditions.values)}　<b>例外：</b>{listText([...new Set([...source.source.conditions.exceptions, ...policy.weiku.conditions.exclusions])])}</p>
        <p><b>研究参加者年齢：</b>{researchAgeText(source)}　<b>研究地域：</b>{researchRegionText(source)}</p>
        <p><b>日本での適用：</b>{policyModeText(policy.weiku.japanApplicability.mode)} {policy.weiku.japanApplicability.value ?? ""}</p>
        <p><b>確実性：</b>{policyModeText(policy.certainty.mode)} {policy.certainty.level ?? ""}　<b>評価法：</b>{policy.certainty.assessmentMethod ?? "記録なし"}</p>
        <p><b>利用条件：</b>{policyModeText(policy.usage.mode)} {policy.usage.terms ?? ""}　<b>利用上の例外：</b>{listText(policy.usage.exceptions)}</p>
        <p><b>照合状況：</b>対象 {source.applicability.target}／年齢 {source.applicability.age}／地域 {source.applicability.region}／条件 {source.applicability.conditions}／日本 {source.applicability.japan}</p>
      </details>
      {source.requiredContext.length > 0 && (
        <details>
          <summary>一緒に確認が必要な原文箇所</summary>
          {source.requiredContext.map((context) => (
            <section className="answer-required-context" key={context.sectionId}>
              <p><b>{context.role}：</b>{context.originalText}</p>
              <p>sourceId: {context.citation.sourceId}<br />versionId: {context.citation.versionId}<br />sectionId: {context.sectionId}</p>
              <p>版：{context.citation.version}　掲載箇所：{context.sourceLocation}</p>
              <p>原資料：<a href={context.citation.originalUrl} target="_blank" rel="noreferrer">{context.citation.title}</a></p>
              <p>節見出し：{context.section.heading ?? "記録なし"}　注記：{context.notes ?? "記録なし"}</p>
              <details>
                <summary>この原文箇所の条件・不確実性</summary>
                <p>対象：{policyModeText(context.section.resolvedApplicabilityPolicy.weiku.target.mode)} {context.section.resolvedApplicabilityPolicy.weiku.target.values.join("・") || "記録なし"}</p>
                <p>条件：{policyModeText(context.section.resolvedApplicabilityPolicy.weiku.conditions.mode)} {listText(context.section.resolvedApplicabilityPolicy.weiku.conditions.values)}　例外：{listText(context.section.resolvedApplicabilityPolicy.weiku.conditions.exclusions)}</p>
                <p>研究参加者年齢：{policyModeText(context.section.resolvedApplicabilityPolicy.research.participantAge.mode)}　研究地域：{policyModeText(context.section.resolvedApplicabilityPolicy.research.regions.mode)}</p>
                <p>確実性：{policyModeText(context.section.resolvedApplicabilityPolicy.certainty.mode)} {context.section.resolvedApplicabilityPolicy.certainty.level ?? ""}</p>
              </details>
            </section>
          ))}
        </details>
      )}
    </article>
  );
}