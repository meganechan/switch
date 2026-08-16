import { ChevronDown, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps, useModalContext } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { cn } from '@renderer/utils/utils';

type Props = BaseModalProps<void> & {
  serverId: string;
  switchAgentId: string;
  agentName: string;
};

/** A room the agent can be put in: one on its own server it is not already in. */
type Candidate = { id: string; name: string };

/**
 * Puts one agent into rooms — the agent's side of `AddAgentsToRoomModal`, which
 * puts agents into one room.
 *
 * Both write the same membership through `addRoomAgents`; which one you reach
 * for is only a matter of what you were looking at. An agent can only join rooms
 * on the server it is registered with, so the choice is scoped to that server.
 */
export const AddAgentToRoomsModal = observer(function AddAgentToRoomsModal({
  serverId,
  switchAgentId,
  agentName,
  onSuccess,
  onClose,
}: Props) {
  const { setCloseGuard } = useModalContext();

  const [selected, setSelected] = useState<Candidate[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Membership comes from the same cache the sidebar draws the room tree from,
  // so the rooms offered here and the rooms the agent is shown under cannot
  // disagree. Undefined means it was never fetched — offering every room then
  // would invite a join that is already in place, so say so instead.
  const memberships = switchRoomsStore.roomsFor(serverId, switchAgentId);
  const membershipUnknown = memberships === undefined;
  const alreadyIn = new Set((memberships ?? []).map((m) => m.roomId));

  const candidates: Candidate[] = switchRoomsStore
    .listedRoomsOnServer(serverId)
    .filter((room) => !alreadyIn.has(room.id) && !selected.some((s) => s.id === room.id))
    .map((room) => ({ id: room.id, name: room.name }));
  const nothingToAdd = candidates.length === 0 && selected.length === 0;

  const handleSubmit = useCallback(async () => {
    if (selected.length === 0) return;
    setIsSubmitting(true);
    setCloseGuard(true);
    setError(null);
    try {
      for (const room of selected) {
        await rpc.switchServers.addRoomAgents({
          serverId,
          roomId: room.id,
          agentIds: [switchAgentId],
        });
      }
      await switchRoomsStore.refreshRoomState();
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
      setCloseGuard(false);
    }
  }, [serverId, switchAgentId, selected, onSuccess, setCloseGuard]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Add {agentName} to rooms</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <div className="flex w-full flex-col gap-4">
          <Field>
            <FieldLabel>Rooms</FieldLabel>
            <Combobox
              items={candidates}
              value={null}
              onValueChange={(next: Candidate | null) => {
                if (next) setSelected((current) => [...current, next]);
                setError(null);
              }}
              isItemEqualToValue={(a: Candidate, b: Candidate) => a.id === b.id}
              filter={(item: Candidate, query) =>
                item.name.toLowerCase().includes(query.toLowerCase())
              }
              autoHighlight
            >
              <ComboboxTrigger
                disabled={nothingToAdd}
                className={cn(
                  'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
                  nothingToAdd && 'cursor-not-allowed opacity-60'
                )}
              >
                <span className="flex-1 truncate text-left text-foreground-muted">Add a room</span>
                <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
              </ComboboxTrigger>
              <ComboboxContent className="min-w-(--anchor-width)">
                <ComboboxInput showTrigger={false} placeholder="Search rooms…" />
                <ComboboxList>
                  {(item: Candidate) => (
                    <ComboboxItem key={item.id} value={item}>
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No rooms found</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
            {selected.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.map((room) => (
                  <span
                    key={room.id}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
                  >
                    {room.name}
                    <button
                      type="button"
                      aria-label={`Remove ${room.name}`}
                      className="cursor-pointer text-foreground-muted hover:text-foreground"
                      onClick={() =>
                        setSelected((current) => current.filter((r) => r.id !== room.id))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {membershipUnknown && (
              <p className="mt-1 text-xs text-foreground-warning">
                Which rooms {agentName} is already in could not be read, so every room on the server
                is listed. Adding it to one it already belongs to changes nothing.
              </p>
            )}
            {nothingToAdd && !membershipUnknown && (
              <p className="mt-1 text-xs text-foreground-muted">
                {agentName} is already in every room listed on this server.
              </p>
            )}
          </Field>

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={selected.length === 0 || isSubmitting}
        >
          {isSubmitting ? 'Adding…' : 'Add to rooms'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
