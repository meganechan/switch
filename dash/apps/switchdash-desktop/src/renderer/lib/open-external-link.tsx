import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { normalizeExternalHttpUrl } from './external-url';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function confirmOpenExternalLink(url: string, onError?: (error: unknown) => void): void {
  const normalizedUrl = normalizeExternalHttpUrl(url);

  if (!HTTP_URL_PATTERN.test(normalizedUrl)) {
    return;
  }

  showModal('confirmExternalLinkModal', {
    url: normalizedUrl,
    canOpenInSwitchdashBrowser: false,
    onSuccess: () => {
      void rpc.app.openExternal(normalizedUrl).catch((error) => {
        onError?.(error);
      });
    },
  });
}
