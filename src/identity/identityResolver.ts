import { detectProjectName } from '../core/identity/detectProjectName';
import { formatDisplayName, truncateName } from '../core/identity/formatName';
import { buildIdentityKey } from '../core/identity/identityKey';
import { detectProjectType } from '../core/identity/projectType';
import { posixBasename } from '../core/util/path';
import { sanitizeUserText } from '../core/util/text';
import type { WorkspaceIdentityState } from '../configuration/persistence';
import type { NameplateSettings } from '../configuration/settings';
import type { GitSnapshot, IdentitySnapshot, WorkspaceDescriptor } from '../model';
import type { WorkspaceScan } from '../workspace/workspaceScanner';

export function resolveIdentity(
  workspace: WorkspaceDescriptor,
  primaryUri: { readonly name: string; readonly uriString: string },
  git: GitSnapshot | undefined,
  scan: WorkspaceScan,
  state: WorkspaceIdentityState,
  settings: NameplateSettings,
): IdentitySnapshot {
  const detected = detectProjectName(
    {
      workspaceFileName: workspace.workspaceFileName,
      folderName: primaryUri.name,
      manifestDisplayNames: scan.manifestDisplayNames,
      manifestNames: scan.manifestNames,
      repositoryName: git?.remote?.repo,
      repositoryDirName: git ? posixBasename(git.rootUri.path) : undefined,
      relativePathInRepo: git?.relativePath,
    },
    settings.nameSource,
  );
  const detectedName = truncateName(
    formatDisplayName(detected.raw, settings.textTransform, { custom: false }),
  );
  const customName = state.customName ? sanitizeUserText(state.customName) : undefined;
  const displayName = customName
    ? truncateName(formatDisplayName(customName, settings.textTransform, { custom: true }))
    : detectedName;
  const identityKey = buildIdentityKey(
    {
      remoteCanonical: git?.remote?.canonical,
      relativePathInRepo: git?.relativePath,
      worktreeName: git?.worktreeName,
      workspaceUri: workspace.workspaceFile?.toString() ?? primaryUri.uriString,
      workspaceFileName: workspace.workspaceFileName,
      displayName,
    },
    settings.colorSource,
  );
  return {
    key: identityKey.key,
    keySource: identityKey.source,
    detectedRaw: detected.raw,
    detectedSource: detected.source,
    detectedName,
    customName,
    displayName,
    label: state.label ? sanitizeUserText(state.label) : undefined,
    projectType: detectProjectType(scan.signals),
  };
}
