import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

export function useConfirmDeleteProject() {
  const showConfirmDeleteProject = useShowModal('confirmActionModal');

  return async ({
    projectId,
    projectLabel,
    onDeleted,
  }: {
    projectId: string;
    projectLabel: string;
    onDeleted?: () => void;
  }) => {
    showConfirmDeleteProject({
      title: 'Remove agent',
      description: `"${projectLabel}" will be removed from switchdash. The folder stays on the filesystem.`,
      confirmLabel: 'Remove',
      onSuccess: () => {
        void getProjectManagerStore().deleteProject(projectId);
        onDeleted?.();
      },
    });
  };
}
