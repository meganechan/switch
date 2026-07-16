import { ChevronDown, Ellipsis, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useConfirmDeleteProject } from '@renderer/features/projects/hooks/use-confirm-delete-project';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

const MountedProjectTitlebarLeft = observer(function ProjectTitlebarLeft({
  projectId,
}: {
  projectId: string;
}) {
  const { navigate } = useNavigate();
  const store = getProjectStore(projectId);
  const displayName = projectDisplayName(store) ?? 'this project';
  const confirmDeleteProject = useConfirmDeleteProject();

  return (
    <div className="flex h-full items-center gap-2 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="group flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground">
              <span className="text-sm">{displayName}</span>
              <ChevronDown className="size-3.5" />
            </button>
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-40">
          <DropdownMenuItem
            className="flex items-center gap-2 text-foreground-destructive"
            onClick={() => {
              void confirmDeleteProject({
                projectId,
                projectLabel: displayName,
                onDeleted: () => navigate('home'),
              });
            }}
          >
            <Trash2 className="size-4" />
            Remove Agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

const ProjectTitlebarLeft = observer(function ProjectTitlebarLeft({
  projectId,
}: {
  projectId: string;
}) {
  const store = getProjectStore(projectId);
  const displayName = projectDisplayName(store);
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="text-sm text-foreground-muted">{displayName}</span>
    </div>
  );
});

export const ProjectTitlebar = observer(function ProjectTitlebar() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);

  if (kind !== 'ready') {
    return <Titlebar leftSlot={<ProjectTitlebarLeft projectId={projectId} />} />;
  }

  const mounted = asMounted(store);
  if (!mounted) return <Titlebar leftSlot={<ProjectTitlebarLeft projectId={projectId} />} />;

  return (
    <Titlebar
      leftSlot={<MountedProjectTitlebarLeft projectId={projectId} />}
      rightSlot={
        <div className="mr-2 flex items-center gap-2">
          {mounted.data.path !== null && (
            <OpenInMenu path={mounted.data.path} className="h-7 bg-background" />
          )}
        </div>
      }
    />
  );
});
