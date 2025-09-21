import { appOutputAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";

// Console component
export const Console = () => {
  const appOutput = useAtomValue(appOutputAtom);
  return (
    <div className="font-mono text-xs px-4 h-full overflow-auto">
      {appOutput.map((output, index) => (
        <div key={index}>{output.message}</div>
      ))}
    </div>
  );
};
