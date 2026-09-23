import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SCENE_UNITS, REVIEW_DIMENSIONS } from "./policy.mjs";

const root = path.resolve("evidence-work/private-parenting-trial-11/plan");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function loadPlans() {
  const files = {
    scenes: "scenes.json",
    rubric: "evaluation-rubric.json",
    budget: "model-budget.json",
    history: "history-reconciliation.json",
  };
  const loaded = {};
  const hashes = {};
  for (const [key, name] of Object.entries(files)) {
    const bytes = fs.readFileSync(path.join(root, name));
    loaded[key] = JSON.parse(bytes);
    hashes[name] = sha(bytes);
  }
  validate(loaded);
  return Object.freeze({ ...loaded, hashes: Object.freeze(hashes) });
}

function validate({ scenes, rubric, budget, history }) {
  if (scenes?.format !== "weiku.private-parenting-trial-11.scenes.v1"
    || !Array.isArray(scenes.scenes) || scenes.scenes.length !== 5
    || scenes.maximums?.totalModelOutputs !== 14) throw new Error("SCENE_PLAN_SCHEMA");
  const ids = new Set();
  for (const scene of scenes.scenes) {
    if (!SCENE_UNITS[scene.id] || ids.has(scene.id)
      || JSON.stringify(scene.sourceUnitIds) !== JSON.stringify(SCENE_UNITS[scene.id])
      || !Array.isArray(scene.factRegistry) || !scene.initialUserMessage
      || !Array.isArray(scene.selectableFollowUps)
      || !Number.isSafeInteger(scene.maximumModelOutputs)) throw new Error("SCENE_PLAN_SCHEMA");
    ids.add(scene.id);
    const facts = new Set(scene.factRegistry.map(fact => fact.id));
    const messages = [scene.initialUserMessage, ...scene.selectableFollowUps];
    for (const message of messages) {
      if (typeof message.text !== "string" || !message.text.trim()
        || !Array.isArray(message.usedFactIds) || !message.usedFactIds.every(id => facts.has(id))) {
        throw new Error("FACT_BOUND_MESSAGE_SCHEMA");
      }
    }
  }
  if (rubric?.format !== "weiku.private-parenting-trial-11.evaluation-rubric.v1"
    || rubric.status !== "fixed_before_execution"
    || JSON.stringify(rubric.dimensions?.map(item => item.id)) !== JSON.stringify(REVIEW_DIMENSIONS)) {
    throw new Error("RUBRIC_SCHEMA");
  }
  if (budget?.format !== "weiku.private-parenting-trial-11.model-budget.v1"
    || budget.futureRunMaximums?.maximumNewApiTransmissions !== 14
    || budget.authorization?.authorizedNewTransmissionsNow !== 0
    || budget.authorization?.requestBodiesMayBeAssembledLocally !== true
    || budget.authorization?.externalTransmissionAllowedNow !== false) throw new Error("BUDGET_SCHEMA");
  if (history?.currentCumulativeProviderTransmissions !== 47
    || history.currentTrial?.providerTransmissions !== 0
    || history.currentTrial?.authorizedAdditionalTransmissions !== 0) throw new Error("HISTORY_SCHEMA");
}

export function selectedMessage(scene, messageId) {
  if (messageId === "initial") return scene.initialUserMessage;
  const found = scene.selectableFollowUps.find(item => item.id === messageId);
  if (!found) throw new Error("UNREGISTERED_PARENT_MESSAGE");
  return found;
}