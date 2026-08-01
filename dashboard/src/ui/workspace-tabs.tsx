import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { I } from "../icons";

export interface WorkspaceTab {
  id: string;
  path: string;
  name: string;
  active: boolean;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
}

export function WorkspaceTabs({ tabs, activeId, onSelect, onNew, onClose }: WorkspaceTabsProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onClose(id);
    },
    [onClose],
  );

  return (
    <div className="workspace-tabs">
      <div className="workspace-tab-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`workspace-tab ${tab.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(tab.id)}
            title={tab.path}
          >
            <span className="workspace-tab-name">{tab.name}</span>
            {tabs.length > 1 && (
              <span
                className="workspace-tab-close"
                role="button"
                aria-label={t("workspaceTab.close")}
                onClick={(e) => handleClose(e, tab.id)}
              >
                <I.x size={10} />
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="workspace-tab-new"
        onClick={onNew}
        title={t("workspaceTab.new")}
      >
        <I.plus size={12} />
      </button>
    </div>
  );
}

export default WorkspaceTabs;