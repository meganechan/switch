/**
 * The client ↔ sidecar contract version.
 *
 * This answers a different question from the bundle hash, and conflating the
 * two was a real bug: the hash was used both for "should I upgrade this?" and
 * "can I talk to this?", so two clients on different builds each judged the
 * other's sidecar unusable, killed it, and relaunched — permanently, while
 * pruning their own session rows in the gaps.
 *
 * - `protocolVersion` — semantic. Governs whether a client can *use* a running
 *   sidecar. Bump it only when the wire contract changes incompatibly: the
 *   ready-line shape, an endpoint's request/response, or the on-disk layout the
 *   two sides share.
 * - the bundle hash — an identity, not an ordering. Governs only whether a
 *   sidecar is the exact build this client ships, i.e. whether an upgrade is
 *   *available*. Never whether it is usable.
 */
export const SIDECAR_PROTOCOL_VERSION = 1;

/**
 * Oldest protocol this client can still speak. Raise it only when support for
 * an older sidecar is genuinely dropped — every sidecar below it gets replaced
 * on sight, including ones with live sessions.
 *
 * A sidecar predating protocol reporting altogether is treated as version 0.
 */
export const MIN_SUPPORTED_SIDECAR_PROTOCOL = 0;
