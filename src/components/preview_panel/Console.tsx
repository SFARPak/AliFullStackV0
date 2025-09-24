import { appOutputAtom, frontendTerminalOutputAtom, backendTerminalOutputAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useState, useRef, useCallback, useEffect } from "react";
import * as React from "react";

// Console component with side-by-side terminal support and resizable panels
export const Console = () => {
  const appOutput = useAtomValue(appOutputAtom);
  const frontendTerminalOutput = useAtomValue(frontendTerminalOutputAtom);
  const backendTerminalOutput = useAtomValue(backendTerminalOutputAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(selectedAppId);

  // State for panel sizes (percentages)
  const [panelSizes, setPanelSizes] = useState({
    left: 50,
    right: 50,
    left2: 33.33,
    middle: 33.33,
    right2: 33.34,
  });

  // Refs for drag handles
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const dragHandle2Ref = useRef<HTMLDivElement>(null);
  const dragHandle3Ref = useRef<HTMLDivElement>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startSizes, setStartSizes] = useState(panelSizes);

  const handleMouseDown = useCallback((handleId: string, event: React.MouseEvent) => {
    setIsDragging(handleId);
    setStartX(event.clientX);
    setStartSizes({ ...panelSizes });
    event.preventDefault();
  }, [panelSizes]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isDragging) return;

    const container = document.querySelector('[data-terminal-container]');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const deltaX = event.clientX - startX;
    const containerWidth = rect.width;

    if (isDragging === 'left-right') {
      // Two panel resize
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newLeft = Math.max(20, Math.min(80, startSizes.left + deltaPercent));
      const newRight = 100 - newLeft;
      setPanelSizes(prev => ({ ...prev, left: newLeft, right: newRight }));
    } else if (isDragging === 'left-middle') {
      // Three panel resize (left-middle)
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newLeft2 = Math.max(15, Math.min(50, startSizes.left2 + deltaPercent));
      const totalMiddleRight = 100 - newLeft2;
      const newMiddle = totalMiddleRight * (startSizes.middle / (startSizes.middle + startSizes.right2));
      const newRight2 = totalMiddleRight - newMiddle;
      setPanelSizes(prev => ({ ...prev, left2: newLeft2, middle: newMiddle, right2: newRight2 }));
    } else if (isDragging === 'middle-right') {
      // Three panel resize (middle-right)
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newRight2 = Math.max(15, Math.min(50, startSizes.right2 - deltaPercent));
      const totalLeftMiddle = 100 - newRight2;
      const newMiddle = totalLeftMiddle * (startSizes.middle / (startSizes.left2 + startSizes.middle));
      const newLeft2 = totalLeftMiddle - newMiddle;
      setPanelSizes(prev => ({ ...prev, left2: newLeft2, middle: newMiddle, right2: newRight2 }));
    }
  }, [isDragging, startX, startSizes]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  // Add global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Determine which terminals to show
  const hasFrontendOutput = frontendTerminalOutput.length > 0;
  const hasBackendOutput = backendTerminalOutput.length > 0;
  const hasMain = appOutput.length > 0;

  // Check if app has frontend/backend folders (always show terminals for apps that have these folders)
  const hasFrontendFolder = app?.files?.some((file: string) => file.startsWith("frontend/")) || false;
  const hasBackendFolder = app?.files?.some((file: string) => file.startsWith("backend/")) || false;

  // Terminals are visible if they have content OR if the app has the corresponding folder
  const hasFrontend = hasFrontendOutput || hasFrontendFolder;
  // Backend terminal shows if it has output OR if there's backend folder AND main terminal has backend-prefixed content
  const hasBackend = hasBackendOutput || (hasBackendFolder && appOutput.some(output => output.message.includes('[BACKEND]')));
  // Main (System) terminal shows if it has any content (including combined backend output)
  const hasSystem = hasMain;

  // Show all terminals if any terminal has content (to ensure Frontend is visible when Backend/System have content)
  const totalTerminals = (hasFrontend ? 1 : 0) + (hasBackend ? 1 : 0) + (hasSystem ? 1 : 0);
  const showAllTerminals = totalTerminals > 0;

  // Count active terminals
  const activeTerminals = [
    (hasSystem || showAllTerminals) && "main",
    (hasFrontend || showAllTerminals) && "frontend",
    (hasBackend || showAllTerminals) && "backend"
  ].filter(Boolean);
  const terminalCount = activeTerminals.length;

  // Terminal rendering component with proper color classes
  const TerminalPanel = ({ title, outputs, color }: { title: string; outputs: any[]; color: "green" | "orange" | "blue" }) => {
    const colorClasses = {
      green: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
      orange: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
      blue: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
    };

    return (
      <div className="flex flex-col h-full">
        <div className={`px-3 py-2 ${colorClasses[color]} text-xs font-medium border-b border-border`}>
          {title} ({outputs.length})
        </div>
        <div className="font-mono text-xs px-4 flex-1 overflow-auto">
          {outputs.map((output, index) => (
            <div key={index}>{output.message}</div>
          ))}
        </div>
      </div>
    );
  };

  // Drag handle component
  const DragHandle = ({ onMouseDown, className = "" }: { onMouseDown: (e: React.MouseEvent) => void; className?: string }) => (
    <div
      className={`w-1 bg-border hover:bg-accent cursor-col-resize active:bg-primary transition-colors ${className}`}
      onMouseDown={onMouseDown}
      style={{ userSelect: 'none' }}
    />
  );

  // Resizable container wrapper
  const ResizableContainer = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div data-terminal-container className={`flex h-full ${className}`}>
      {children}
    </div>
  );

  // Single terminal layout
  if (terminalCount === 1) {
    if (hasFrontend) {
      return <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />;
    }
    if (hasBackend) {
      return <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />;
    }
    if (hasSystem) {
      return <TerminalPanel title="System" outputs={appOutput} color="blue" />;
    }
    return <TerminalPanel title="System" outputs={appOutput} color="blue" />;
  }

  // Two terminals layout
  if (terminalCount === 2) {
    if (hasFrontend && hasBackend) {
      // Frontend and Backend side by side
      return (
        <ResizableContainer>
          <div className="h-full" style={{ width: `${panelSizes.left}%` }}>
            <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
          </div>
          <DragHandle onMouseDown={(e) => handleMouseDown('left-right', e)} />
          <div className="h-full" style={{ width: `${panelSizes.right}%` }}>
            <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
          </div>
        </ResizableContainer>
      );
    }
    if (hasSystem && hasFrontend) {
      // System and Frontend side by side
      return (
        <ResizableContainer>
          <div className="h-full" style={{ width: `${panelSizes.left}%` }}>
            <TerminalPanel title="System" outputs={appOutput} color="blue" />
          </div>
          <DragHandle onMouseDown={(e) => handleMouseDown('left-right', e)} />
          <div className="h-full" style={{ width: `${panelSizes.right}%` }}>
            <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
          </div>
        </ResizableContainer>
      );
    }
    if (hasSystem && hasBackend) {
      // System and Backend side by side
      return (
        <ResizableContainer>
          <div className="h-full" style={{ width: `${panelSizes.left}%` }}>
            <TerminalPanel title="System" outputs={appOutput} color="blue" />
          </div>
          <DragHandle onMouseDown={(e) => handleMouseDown('left-right', e)} />
          <div className="h-full" style={{ width: `${panelSizes.right}%` }}>
            <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
          </div>
        </ResizableContainer>
      );
    }
  }

  // Three terminals layout - show in a 3-column layout with resizable panels
  if (terminalCount === 3) {
    return (
      <ResizableContainer>
        <div className="h-full" style={{ width: `${panelSizes.left2}%` }}>
          <TerminalPanel title="System" outputs={appOutput} color="blue" />
        </div>
        <DragHandle onMouseDown={(e) => handleMouseDown('left-middle', e)} />
        <div className="h-full" style={{ width: `${panelSizes.middle}%` }}>
          <TerminalPanel title="Frontend" outputs={frontendTerminalOutput} color="green" />
        </div>
        <DragHandle onMouseDown={(e) => handleMouseDown('middle-right', e)} />
        <div className="h-full" style={{ width: `${panelSizes.right2}%` }}>
          <TerminalPanel title="Backend" outputs={backendTerminalOutput} color="orange" />
        </div>
      </ResizableContainer>
    );
  }

  // Fallback - show system terminal
  return <TerminalPanel title="System" outputs={appOutput} color="blue" />;
};
