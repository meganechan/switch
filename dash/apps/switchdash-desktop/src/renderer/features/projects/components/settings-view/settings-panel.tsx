import { observer } from 'mobx-react-lite';
import { AutoSessionSettingsSection } from '@renderer/features/projects/components/settings-view/sections/auto-session-settings-section';
import { ConnectionSettingsSection } from '@renderer/features/projects/components/settings-view/sections/connection-settings-section';
import { SubagentAutoSessionSettingsSection } from '@renderer/features/projects/components/settings-view/sections/subagent-auto-session-settings-section';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Spinner } from '@renderer/lib/ui/spinner';

export const SettingsPanel = observer(function SettingsPanel() {
  const {
    params: { projectId, subagentName },
  } = useParams('project');
  const mounted = asMounted(getProjectStore(projectId));

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {subagentName ? (
        <SubagentAutoSessionSettingsSection projectId={projectId} subagentName={subagentName} />
      ) : (
        <>
          <AutoSessionSettingsSection projectId={projectId} />
          <ConnectionSettingsSection projectId={projectId} />
        </>
      )}
    </div>
  );
});
