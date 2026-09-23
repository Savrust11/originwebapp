/*
 * An intentionally tiny, owned server for the consultation prototype.  It
 * does not import server/index.ts, routes.ts, Vite, or any normal app module.
 * Keep the authorization guard as the first dependency: pool/service imports
 * below are not evaluated until the managed ancestry and private PG target are
 * proven.
 */
import "./require-managed.mjs";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Request, Response } from "express";
import type { ConsultationInput } from "../../prototypes/evidence-consultation/contract.ts";
import type {
  AnswerRequest,
  AnswerResponse,
} from "../../prototypes/evidence-consultation/answer-contract.ts";

function stop(pool: { end(): Promise<void> }, code = 1) {
  process.exitCode = code;
  void pool.end().finally(() => process.exit());
}

function authorizedEnvironment() {
  const draftOnly = process.env.EVIDENCE_PROTOTYPE_DRAFT === "true";
  return process.env.EVIDENCE_PROTOTYPE_TEST === "true"
    && process.env.EVIDENCE_SEARCH_ENABLED === "true"
    && process.env.NODE_ENV === "test"
    && process.env.MANAGED_TEST_SERVER_IPC === "1"
    && (process.env.EVIDENCE_PROTOTYPE_LIFECYCLE === undefined || process.env.EVIDENCE_PROTOTYPE_LIFECYCLE === "true")
    && (process.env.EVIDENCE_PROTOTYPE_DRAFT === undefined || draftOnly)
    && typeof process.send === "function";
}

function sameOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  const host = req.get("host");
  // Do not derive the trusted origin from the caller-controlled Host header.
  // This owned listener is deliberately IPv4 loopback only.
  const port = req.socket.localPort;
  const expectedOrigin = Number.isInteger(port) ? `http://127.0.0.1:${port}` : null;
  return expectedOrigin !== null && host === `127.0.0.1:${port}` && origin === expectedOrigin;
}

function csp(response: Response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; font-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'",
  );
}

const ANSWER_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ANSWER_CACHE_LIMIT = 128;
const ANSWER_CACHE_TTL_MS = 5 * 60_000;
// This deliberately process-local tombstone expires after five minutes and is
// lost on server restart. The UI therefore creates a new UUID for every retry;
// it is not a durable cross-process idempotency mechanism.

type AnswerExecution = {
  digest: string;
  expiresAt: number;
  state: "running" | "complete";
};

/**
 * The request ID is deliberately the only client-provided identifier kept by
 * the server.  The body is reduced to a hash as soon as it has been parsed:
 * questions are never written to logs, files, or this idempotency store.
 */
function answerRequestMetadata(body: unknown): { request: AnswerRequest; digest: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!Object.keys(body).every((key) => key === "requestId" || key === "consultation" || key === "urgentConcern")) return null;
  const request = body as Partial<AnswerRequest>;
  if (
    typeof request.requestId !== "string"
    || !ANSWER_REQUEST_ID.test(request.requestId)
    || (request.urgentConcern !== "yes" && request.urgentConcern !== "no" && request.urgentConcern !== "unknown")
    || !request.consultation
    || typeof request.consultation !== "object"
    || Array.isArray(request.consultation)
  ) return null;
  // JSON bodies have no cycles.  This digest is for replay comparison only,
  // never for lookup outside this bounded in-memory process-local cache.
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("base64url");
  return { request: request as AnswerRequest, digest };
}

function makeAnswerExecutionRoom(executions: Map<string, AnswerExecution>, now = Date.now()) {
  for (const [requestId, entry] of executions) {
    // An active duplicate must remain protected even if a slow worker outlives
    // the normal TTL. Completion is a tombstone rather than a response cache:
    // a later request must retrieve the current source/version state afresh.
    if (entry.state === "complete" && entry.expiresAt <= now) executions.delete(requestId);
  }
  while (executions.size >= ANSWER_CACHE_LIMIT) {
    const completed = [...executions.entries()]
      .filter(([, entry]) => entry.state === "complete")
      .sort(([, left], [, right]) => left.expiresAt - right.expiresAt)[0];
    if (!completed) return false;
    executions.delete(completed[0]);
  }
  return true;
}

if (!authorizedEnvironment()) {
  process.exitCode = 1;
  process.exit();
} else {
  // Dynamic imports make the gate above an execution boundary before any pool,
  // Express server, corpus, service, or bundler module can be evaluated.
  const { default: express } = await import("express");
  const { pool } = await import("../../server/db.ts");
  const lifecycleOnly = process.env.EVIDENCE_PROTOTYPE_LIFECYCLE === "true";
  const draftOnly = process.env.EVIDENCE_PROTOTYPE_DRAFT === "true";
  const connectivity = await pool.query<{ ok: number }>("SELECT 1 AS ok");
  if (connectivity.rows[0]?.ok !== 1) throw new Error("prototype pool boundary failed");
  const bundle = lifecycleOnly || draftOnly
    ? null
    : await (await import("./prototype-bundle.mjs")).buildEvidenceConsultationPrototype();
  let searchConsultation: null | ((pool: typeof import("../../server/db.ts").pool, input: ConsultationInput) => Promise<unknown>) = null;
  let checkOfflineAnswer: null | ((
    pool: typeof import("../../server/db.ts").pool,
    request: AnswerRequest,
    options: { signal: AbortSignal },
  ) => Promise<AnswerResponse>) = null;
  let validateAnswerRequest: null | ((input: unknown) =>
    { ok: true; value: AnswerRequest } | { ok: false; errors: string[] }) = null;
  if (!lifecycleOnly) {
    const setup = await import("../fixtures/real-corpus/setup.mts");
    const service = await import("../../prototypes/evidence-consultation/service.mts");
    const answerService = await import("../../prototypes/evidence-consultation/answer-service.mts");
    searchConsultation = service.searchConsultation;
    if (typeof answerService.checkOfflineAnswer !== "function") {
      throw new Error("prototype answer service boundary failed");
    }
    if (typeof answerService.validateAnswerRequest !== "function") {
      throw new Error("prototype answer parser boundary failed");
    }
    checkOfflineAnswer = answerService.checkOfflineAnswer;
    validateAnswerRequest = answerService.validateAnswerRequest;
    const corpus = draftOnly
      ? await setup.importCorpus(pool, "normal-route-http-draft")
      : await setup.initializePrototypeCorpus(pool);
    if (draftOnly) {
      await setup.linkCuratedConcepts(pool, corpus.byUnit, corpus.byFragment, "normal-route-http-draft");
      await setup.linkRequiredContext(pool, corpus.byUnit, corpus.byFragment);
    }
    // The initializer exposes its persisted unit/source maps for verification;
    // no corpus metadata is invented by this server.
    if (
      !corpus
      || !(corpus.byUnit instanceof Map)
      || !(corpus.corpus.sources instanceof Map)
      || corpus.byUnit.size !== 11
      || corpus.corpus.sources.size !== 4
    ) {
      throw new Error("prototype corpus initialization failed");
    }
    const publication = draftOnly
      ? await pool.query<{
        sources: number; versions: number; simulated: number; manually_reviewed: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM evidence_sources WHERE test_only) AS sources,
          (SELECT count(*)::integer FROM evidence_versions WHERE test_only) AS versions,
          (SELECT count(*)::integer FROM evidence_versions WHERE publication_status = 'published') AS simulated,
          (SELECT count(*)::integer FROM evidence_versions WHERE manual_reviewed) AS manually_reviewed
      `)
      : await (async () => {
        const { REAL_CORPUS_SIMULATION_MARKER } = await import("../fixtures/real-corpus/publication-simulation.mts");
        return pool.query<{
          sources: number; versions: number; simulated: number; manually_reviewed: number;
        }>(`
          SELECT
            (SELECT count(*)::integer FROM evidence_sources WHERE test_only) AS sources,
            (SELECT count(*)::integer FROM evidence_versions WHERE test_only) AS versions,
            (SELECT count(*)::integer FROM evidence_test_publication_simulations WHERE test_marker = $1) AS simulated,
            (SELECT count(*)::integer FROM evidence_versions WHERE manual_reviewed) AS manually_reviewed
        `, [REAL_CORPUS_SIMULATION_MARKER]);
      })();
    const counts = publication.rows[0];
    if (!counts || counts.sources !== 4 || counts.versions !== 4
      || counts.simulated !== (draftOnly ? 0 : 4) || counts.manually_reviewed !== 0) {
      throw new Error("prototype corpus publication boundary failed");
    }
  }

  const app = express();
  const activeAnswerControllers = new Set<AbortController>();
  const answerExecutions = new Map<string, AnswerExecution>();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    csp(res);
    next();
  });
  app.get("/", (_req, res) => {
    if (lifecycleOnly || draftOnly) {
      res.status(204).end();
      return;
    }
    res.type("html").send(bundle!.index);
  });
  app.get("/assets/:name", (req, res) => {
    const name = req.params.name;
    if (lifecycleOnly || !/^[A-Za-z0-9._-]+$/.test(name) || !bundle!.assets.has(name)) {
      res.status(404).end();
      return;
    }
    const file = path.join(bundle!.root, "assets", name);
    if (!fs.existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.sendFile(file, { dotfiles: "deny", cacheControl: false });
  });
  app.post(
    "/api/prototype/evidence",
    express.json({ limit: "32kb", type: "application/json" }),
    async (req, res) => {
      if (!req.is("application/json") || !sameOrigin(req)) {
        res.status(403).end();
        return;
      }
      try {
        if (!searchConsultation) {
          res.status(404).end();
          return;
        }
        const result = await searchConsultation(pool, req.body as ConsultationInput);
        res.type("json").send(result);
      } catch {
        // A browser sees no database/service detail and no submitted content.
        res.status(503).end();
      }
    },
  );
  app.post(
    "/api/prototype/answer",
    express.json({ limit: "16kb", strict: true, type: "application/json" }),
    async (req, res) => {
      if (!req.is("application/json") || !sameOrigin(req)) {
        res.status(403).end();
        return;
      }
      if (!checkOfflineAnswer || !validateAnswerRequest) {
        res.status(404).end();
        return;
      }
      const metadata = answerRequestMetadata(req.body);
      if (!metadata) {
        // Do not echo a malformed body, request ID, or question.
        res.status(400).end();
        return;
      }
      const validated = validateAnswerRequest(req.body);
      if (!validated.ok) {
        // The service parser also rejects extra nested evidence, references,
        // history, and profile fields before any search can start.
        res.status(400).end();
        return;
      }
      const existing = answerExecutions.get(metadata.request.requestId);
      if (existing) {
        if (existing.state === "complete" && existing.expiresAt <= Date.now()) {
          answerExecutions.delete(metadata.request.requestId);
        } else {
          // Both same- and different-body replays are refused with the same
          // opaque response. The stored digest is the sole non-raw body
          // identity and no obsolete evidence response is replayed.
          void existing.digest;
          res.status(409).end();
          return;
        }
      }
      if (!makeAnswerExecutionRoom(answerExecutions)) {
        res.status(429).end();
        return;
      }

      const controller = new AbortController();
      const abortIfDisconnected = () => {
        if (!res.writableEnded) controller.abort();
      };
      req.once("aborted", () => controller.abort());
      res.once("close", abortIfDisconnected);
      activeAnswerControllers.add(controller);
      const entry: AnswerExecution = {
        digest: metadata.digest,
        expiresAt: Date.now() + ANSWER_CACHE_TTL_MS,
        state: "running",
      };
      answerExecutions.set(metadata.request.requestId, entry);
      try {
        const response = await checkOfflineAnswer(pool, validated.value, { signal: controller.signal });
        if (controller.signal.aborted) {
          answerExecutions.delete(metadata.request.requestId);
          res.status(499).end();
          return;
        }
        entry.state = "complete";
        entry.expiresAt = Date.now() + ANSWER_CACHE_TTL_MS;
        res.type("json").send(response);
      } catch {
        // An abort is not an answer and remains retryable. Other failures are
        // also not cached so an unavailable worker cannot poison a request ID.
        answerExecutions.delete(metadata.request.requestId);
        if (!res.headersSent) res.status(controller.signal.aborted ? 499 : 503).end();
      } finally {
        activeAnswerControllers.delete(controller);
        res.off("close", abortIfDisconnected);
      }
    },
  );
  app.use((_req, res) => res.status(404).end());
  app.use((_error: unknown, _req: Request, res: Response, _next: () => void) => {
    // Includes malformed/over-limit JSON. Never serialize parser details.
    res.status(413).end();
  });

  const server = app.listen({ host: "127.0.0.1", port: 0 }, () => {
    const address = server.address();
    if (!address || typeof address === "string" || !Number.isInteger(address.port) || !process.send) {
      stop(pool);
      return;
    }
    process.send({ type: "managed-server-listening", pid: process.pid, port: address.port });
  });
  server.once("close", () => {
    for (const controller of activeAnswerControllers) controller.abort();
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.once(signal, () => {
      // close() waits for open requests, so abort the worker before asking the
      // listener to drain. The close listener above covers non-signal closes.
      for (const controller of activeAnswerControllers) controller.abort();
      server.close(() => stop(pool, 0));
    });
  }
}