// Prospective-only pure checks. Never import a runner, read credentials, or send.
export const VALIDATOR_VERSION = "comparison-answer-v3";
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).length === allowed.length
  && allowed.every(k => Object.hasOwn(v, k));
const modelIdentity = /gpt[-\s]?\d|openai|\bluna\b|\bsol\b|ルナ|ソル/i;
// Deliberately conservative: even short secret-like prefixes are rejected.
// The exemption below is exact, request-scoped public IDs, not arbitrary "sk-".
const secret = /api[_ -]?key|bearer\s|sk-[a-z0-9]|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i;
const publicId = /^E\d{2}-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const codes = new Set([
  "answer_json_invalid", "answer_schema_invalid", "answer_source_context_invalid",
  "answer_citation_missing", "answer_citation_unknown", "answer_secret_leak",
  "answer_model_identity_leak", "answer_validation_internal_error",
]);
class AnswerValidationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const require = (condition, code) => {
  if (!condition) throw new AnswerValidationError(code);
};
// Never persist exception.message: parsers/unknown exceptions may echo input.
const safeCode = error => error instanceof AnswerValidationError && codes.has(error.code)
  ? error.code : "answer_validation_internal_error";
function checkSourceIds(sourceIds) {
  require(Array.isArray(sourceIds) && sourceIds.every(id => typeof id === "string" && publicId.test(id)),
    "answer_source_context_invalid");
}

export function validateAnswerStructure(answer) {
  require(keys(answer, ["explanations", "limitations", "abstention"])
    && Array.isArray(answer.explanations) && Array.isArray(answer.limitations), "answer_schema_invalid");
  const clause = (value, abstention = false) => {
    require(keys(value, abstention ? ["text", "original_ids", "applies"] : ["text", "original_ids"])
      && typeof value.text === "string" && Array.isArray(value.original_ids)
      && value.original_ids.every(id => typeof id === "string")
      && (!abstention || typeof value.applies === "boolean"), "answer_schema_invalid");
  };
  answer.explanations.forEach(v => clause(v));
  answer.limitations.forEach(v => clause(v));
  clause(answer.abstention, true);
  return answer;
}

export function validateAnswerCitations(answer, sourceIds) {
  checkSourceIds(sourceIds);
  require(answer.explanations.every(v => v.original_ids.length > 0), "answer_citation_missing");
  require([...answer.explanations, ...answer.limitations, answer.abstention]
    .every(v => v.original_ids.every(id => sourceIds.includes(id))), "answer_citation_unknown");
  return answer;
}

function withoutPublicIds(value, sourceIds) {
  // Maximal identifier tokens: no substring replacement inside a key, a longer
  // ID, a changed-case ID, or a suffix/prefix attached to a public ID.
  const allowed = new Set(sourceIds);
  return value.replace(/[A-Za-z0-9_-]+/g, token => allowed.has(token) ? " " : token);
}
function leakReasons(value, sourceIds, credential) {
  // Scan decoded keys AND values, not JSON serialization (which would hide
  // whitespace escapes). A known credential is never covered by an exemption.
  let secretFound = false, modelFound = false;
  const scan = value => {
    if (typeof value === "string") {
      if (typeof credential === "string" && credential.length && value.includes(credential)) secretFound = true;
      if (secret.test(withoutPublicIds(value, sourceIds))) secretFound = true;
      if (modelIdentity.test(value)) modelFound = true;
    } else if (Array.isArray(value)) value.forEach(scan);
    else if (object(value)) for (const [key, child] of Object.entries(value)) { scan(key); scan(child); }
  };
  scan(value);
  return [...(secretFound ? ["answer_secret_leak"] : []), ...(modelFound ? ["answer_model_identity_leak"] : [])];
}

export function validateAnswerIdentity(answer, sourceIds, { credential = "" } = {}) {
  checkSourceIds(sourceIds);
  const reasons = leakReasons(answer, sourceIds, credential);
  require(!reasons.length, reasons[0]);
  return answer;
}

export function validateAnswer(answer, sourceIds, context = {}) {
  validateAnswerStructure(answer);
  validateAnswerCitations(answer, sourceIds);
  validateAnswerIdentity(answer, sourceIds, context);
  return answer;
}

export function inspectAnswerText(outputText, sourceIds, { credential = "" } = {}) {
  const checks = { json: "not-run", structure: "not-run", citations: "not-run",
    secrets: "not-run", modelIdentity: "not-run" };
  const reasons = [];
  let answer = null, sourcesValid = false;
  try { checkSourceIds(sourceIds); sourcesValid = true; } catch (error) { reasons.push(safeCode(error)); }
  try {
    if (typeof outputText !== "string") throw new Error();
    answer = JSON.parse(outputText);
    checks.json = "pass";
  } catch { checks.json = "fail"; reasons.push("answer_json_invalid"); }
  if (checks.json === "pass") {
    try { validateAnswerStructure(answer); checks.structure = "pass"; }
    catch (error) { checks.structure = "fail"; reasons.push(safeCode(error)); }
    if (checks.structure === "pass" && sourcesValid) {
      try { validateAnswerCitations(answer, sourceIds); checks.citations = "pass"; }
      catch (error) { checks.citations = "fail"; reasons.push(safeCode(error)); }
    }
  }
  try {
    // Scan even malformed schema / JSON to avoid retaining suspicious text.
    const leaks = leakReasons(checks.json === "pass" ? answer : outputText,
      sourcesValid ? sourceIds : [], credential);
    reasons.push(...leaks);
    checks.secrets = leaks.includes("answer_secret_leak") ? "fail" : "pass";
    checks.modelIdentity = leaks.includes("answer_model_identity_leak") ? "fail" : "pass";
  } catch {
    reasons.push("answer_validation_internal_error");
    checks.secrets = checks.modelIdentity = "fail";
  }
  return { validatorVersion: VALIDATOR_VERSION, valid: reasons.length === 0,
    answer: reasons.length ? null : answer, reasons: [...new Set(reasons)], checks };
}