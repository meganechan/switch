/**
 * Existence model for a prospective remote working directory (CHOO-1416).
 *
 * A remote agent's working directory is typed as free text, so it is the one
 * input in the add-agent flow that can be wrong in a way nothing else catches:
 * the SSH host is probed for reachability, the server is picked from a list,
 * but the directory was only ever touched at write time — by which point an
 * identity had already been minted on the gateway.
 *
 * switchdash does not create the directory. Making one on someone's host is
 * their decision, and a path typed by hand is exactly where a typo would be
 * silently turned into a real, wrong directory. Inspecting it up front is only
 * so the flow can say which path is missing, while the field is still on screen.
 */

/** What an inspection found at a remote path. */
export type RemoteDirStatus =
  /** The path exists and is a directory — usable as a working directory. */
  | 'directory'
  /** The path exists but is a regular file. */
  | 'file'
  /** The path does not exist. */
  | 'missing';

/** The result of inspecting a prospective remote working directory. */
export type RemoteDirInspection = {
  /** The absolute path inspected, as resolved on the host. */
  dir: string;
  status: RemoteDirStatus;
  /**
   * Deepest ancestor of `dir` that does exist, e.g. `/home/ubuntu` for a
   * missing `/home/ubuntu/switch-agents/internal-deployments`. Empty when the
   * path is not `missing`.
   *
   * Worth surfacing because it separates the two ways this goes wrong: an
   * ancestor one level up means the directory simply has not been made yet,
   * whereas a much shallower one means the path is probably misspelt.
   */
  existingAncestor: string;
};
