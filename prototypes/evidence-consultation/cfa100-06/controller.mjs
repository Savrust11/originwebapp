import {createController as createSearchController} from "../search-repair-05/controller.mjs";
import {renderEvidence} from "./renderer.mjs";
export function createController({search,resolveRegion,onChange=()=>{}}){
  let state;
  const decorate=s=>({...s,presentation:s.status==="ready"||s.status==="needs_city"||s.status==="not_collected"||s.status==="invalid_region"||s.status==="incomplete"
    ?renderEvidence({results:s.results,question:s.question,region:s.region,diagnostics:s.diagnostics}):null});
  const controller=createSearchController({search,resolveRegion,onChange:s=>{state=decorate(s);onChange(structuredClone(state));}});
  return {...controller,getState:()=>state?structuredClone(state):decorate(controller.getState())};
}