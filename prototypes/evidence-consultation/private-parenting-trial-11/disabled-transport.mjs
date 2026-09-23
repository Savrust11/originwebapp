export function createRealTransport() {
  throw new Error("REAL_MODEL_TRANSPORT_DISABLED_CURRENT_AUTHORIZATION_ZERO");
}

export function assertNotSendable() {
  throw new Error("PENDING_REQUEST_LOCAL_ONLY_EXTERNAL_SEND_NOT_AUTHORIZED");
}