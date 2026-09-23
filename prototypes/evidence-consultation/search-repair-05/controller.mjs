// Shared UI/controller boundary. Search must return measured, source-bound results.
export function createController({ search, resolveRegion, onChange = () => {} }) {
  let epoch = 0, abort, state = { status: "idle", question: "", region: null, results: [], clarification: null };
  const emit = patch => { state = { ...state, ...patch }; onChange(structuredClone(state)); return state; };
  function setInput({ question = state.question, region = state.region }) {
    if (question === state.question && JSON.stringify(region) === JSON.stringify(state.region)) return state;
    epoch++; abort?.abort();
    return emit({ question, region, status: "idle", results: [], clarification: null, geography: null, diagnostics: null, error: null });
  }
  async function submit() {
    const token = ++epoch; abort?.abort(); abort = new AbortController();
    const input = { question: state.question, region: state.region };
    const geography = resolveRegion(input);
    emit({ status: "searching", results: [], clarification: geography.clarification ?? null, geography, error: null });
    try {
      const response = await search({ ...input, geography, signal: abort.signal });
      if (token !== epoch) return { stale: true };
      // Ambiguous/unknown local context may never leak local eligibility, fees or contact.
      const results = response.results.filter(result => geography.status === "resolved" || !result.isMunicipal);
      const incomplete = ["expansion_limit","candidate_scan_limit","context_limit"].includes(response.diagnostics?.reason);
      return emit({ status: incomplete ? "incomplete" : geography.status === "invalid_region" ? "invalid_region" : geography.status === "ambiguous" ? "needs_city" : geography.status === "not_collected" ? "not_collected" : "ready", results:incomplete?[]:results, diagnostics: response.diagnostics ?? null });
    } catch (error) {
      if (token !== epoch) return { stale: true };
      return emit({ status: "error", results: [], error: String(error.message ?? error) });
    }
  }
  return { setInput, submit, getState: () => structuredClone(state), dispose() { epoch++; abort?.abort(); } };
}