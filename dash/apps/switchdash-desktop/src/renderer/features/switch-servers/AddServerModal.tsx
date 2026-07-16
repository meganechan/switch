import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { switchServersStore } from './switch-servers-store';

type Props = BaseModalProps<void> & {
  /** Prefill the gateway URL. */
  initialGatewayUrl?: string;
  /** Prefill the API (agent bridge) URL. */
  initialApiUrl?: string;
  /** Prefill the name. */
  initialName?: string;
  /** When set, the modal edits this existing server instead of adding one. */
  serverId?: string;
};

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const AddServerModal = observer(function AddServerModal({
  onSuccess,
  onClose,
  initialGatewayUrl,
  initialApiUrl,
  initialName,
  serverId,
}: Props) {
  const isEdit = serverId != null;
  const [name, setName] = useState(initialName ?? '');
  const [gatewayUrl, setGatewayUrl] = useState(initialGatewayUrl ?? '');
  const [apiUrl, setApiUrl] = useState(initialApiUrl ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedGateway = gatewayUrl.trim();
  const trimmedApi = apiUrl.trim();
  const gatewayValid = looksLikeUrl(trimmedGateway);
  const apiValid = looksLikeUrl(trimmedApi);
  const isValid = trimmedName.length > 0 && gatewayValid && apiValid;

  const gatewayMessage =
    trimmedGateway.length > 0 && !gatewayValid
      ? 'Enter a full URL, e.g. https://switch-gateway.example.com'
      : undefined;
  const apiMessage =
    trimmedApi.length > 0 && !apiValid
      ? 'Enter a full URL, e.g. https://switch-api.example.com'
      : undefined;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    const saved = isEdit
      ? await switchServersStore.updateServer(serverId, trimmedName, trimmedGateway, trimmedApi)
      : await switchServersStore.addServer(trimmedName, trimmedGateway, trimmedApi);
    if (!saved) {
      setError(
        switchServersStore.error ??
          (isEdit ? 'Could not save the server.' : 'Could not add the server.')
      );
      setSubmitting(false);
      return;
    }
    onSuccess();
  }, [isValid, isEdit, serverId, trimmedName, trimmedGateway, trimmedApi, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{isEdit ? 'Edit Switch server' : 'Add Switch server'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Local dev"
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>Gateway URL</FieldLabel>
            <Input
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              placeholder="https://switch-gateway.example.com"
            />
            {gatewayMessage && <p className="text-destructive mt-1 text-xs">{gatewayMessage}</p>}
          </Field>
          <Field>
            <FieldLabel>API URL</FieldLabel>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://switch-api.example.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
            />
            {apiMessage && <p className="text-destructive mt-1 text-xs">{apiMessage}</p>}
            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || submitting}>
          {submitting ? (isEdit ? 'Saving…' : 'Adding…') : isEdit ? 'Save changes' : 'Add server'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
