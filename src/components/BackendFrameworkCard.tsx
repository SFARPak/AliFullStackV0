import React from "react";
import { useSettings } from "@/hooks/useSettings";
import type { BackendFramework } from "@/shared/backendFrameworks";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface BackendFrameworkCardProps {
  framework: BackendFramework;
  isSelected: boolean;
  onSelect: (frameworkId: string) => void;
  onCreateApp: () => void;
}

export const BackendFrameworkCard: React.FC<BackendFrameworkCardProps> = ({
  framework,
  isSelected,
  onSelect,
  onCreateApp,
}) => {
  const { settings } = useSettings();

  const handleCardClick = () => {
    onSelect(framework.id);
  };

  return (
    <div
      onClick={handleCardClick}
      className={`
        bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden
        transform transition-all duration-300 ease-in-out
        cursor-pointer group relative
        ${
          isSelected
            ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-xl"
            : "hover:shadow-lg hover:-translate-y-1"
        }
      `}
    >
      <div className="relative">
        <img
          src={framework.imageUrl}
          alt={framework.title}
          className={`w-full h-52 object-cover transition-opacity duration-300 group-hover:opacity-80 ${
            isSelected ? "opacity-75" : ""
          }`}
        />
        {isSelected && (
          <span className="absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg">
            Selected
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="flex justify-between items-center mb-1.5">
          <h2
            className={`text-lg font-semibold ${
              isSelected
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {framework.title}
          </h2>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              isSelected
                ? "bg-blue-100 text-blue-700 dark:bg-blue-600 dark:text-blue-100"
                : "bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200"
            }`}
          >
            {framework.language}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 h-16 overflow-y-auto">
          {framework.description}
        </p>

        <Button
          onClick={(e) => {
            e.stopPropagation();
            onCreateApp();
          }}
          size="sm"
          className={cn(
            "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold mt-2",
            settings?.selectedBackendFramework !== framework.id && "invisible",
          )}
        >
          Create App
        </Button>
      </div>
    </div>
  );
};