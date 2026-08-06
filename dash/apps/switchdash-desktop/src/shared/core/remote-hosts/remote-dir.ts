/**
 * Existence model for a prospective remote working directory (CHOO-1416).
 *
 * A remote agent's working directory is typed as free text, so it is the one
 * input in the add-agent flow that can be wrong in a way nothing else catches:
 * the SSH host is probed for reachability, the server is picked from a list,
 * but the directory is only ever touched at write time — by which point an
 * identity has already been minted on the gateway.
 *
 * Inspecting it up front turns that into a decision the user makes knowingly.
 * `missingSegments` is what makes a typo legible: a single missing leaf under
 * an existing parent is an ordinary "not created yet", whereas several missing
 * ancestors usually means the path is wrong, and the two should not look the
 * same in the UI.
 */

/** What an inspection found at a remote path. */
export type RemoteDirStatus =
  /** The path exists and is a directory — usable as a working directory. */
  | 'directory'
  /** The path exists but is a regular file, so it can never be created. */
  | 'file'
  /** The path does not exist. `missingSegments` says what creating it implies. */
  | 'missing';

/** The result of inspecting a prospective remote working directory. */
export type RemoteDirInspection = {
  /** The absolute path inspected, as resolved on the host. */
  dir: string;
  status: RemoteDirStatus;
  /**
   * Deepest ancestor of `dir` that already exists, e.g. `/home/ubuntu` for a
   * missing `/home/ubuntu/switch-agents/internal-deployments`. Empty when the
   * path is not `missing`.
   */
  existingAncestor: string;
  /**
   * Path components that creating `dir` would have to make, outermost first
   * (`['switch-agents', 'internal-deployments']` for the example above). Empty
   * when the path is not `missing`. Length > 1 is the typo signal.
   */
  missingSegments: string[];
  /**
   * Whether the SSH user can actually write into {@link existingAncestor}, and
   * so whether creating `dir` is possible at all. False when the path is
   * `missing` but lands somewhere unwritable — typically `/home/<name>` for a
   * misspelt user, which no amount of `mkdir` will fix. Meaningless (and false)
   * when the path is not `missing`.
   *
   * Offering to create a directory is only honest if the create can succeed, so
   * this is resolved during inspection rather than discovered by the user
   * pressing a button that fails.
   */
  creatable: boolean;
};
