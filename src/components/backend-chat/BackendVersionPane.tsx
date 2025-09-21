import { useVersions } from "@/hooks/useVersions";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { X, GitBranch, GitCommit, Clock } from "lucide-react";
import { Button } from "../ui/button";
import { formatDistanceToNow, format } from "date-fns";

interface BackendVersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function BackendVersionPane({ isVisible, onClose }: BackendVersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions, loading } = useVersions(appId);

  if (!isVisible) return null;

  return (
    <div className="w-80 border-l border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-blue-200 dark:border-blue-800">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200">Backend Version History</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 hover:bg-blue-100 dark:hover:bg-blue-900"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-muted-foreground">Loading versions...</div>
        ) : versions.length === 0 ? (
          <div className="text-center text-muted-foreground">No versions yet</div>
        ) : (
          <div className="space-y-3">
            {versions.map((version, index) => (
              <div
                key={version.oid}
                className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-white dark:bg-gray-800"
              >
                <div className="flex items-start gap-3">
                  <GitCommit size={16} className="text-blue-500 mt-1 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
                        {version.oid.slice(0, 7)}
                      </span>
                      {index === 0 && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                          Latest
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mb-2">
                      {version.message || "Backend changes"}
                    </p>
                    {version.author && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <GitBranch size={12} />
                        <span>{version.author.name}</span>
                        <span>•</span>
                        <Clock size={12} />
                        <span>
                          {formatDistanceToNow(new Date(version.date), { addSuffix: true })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}