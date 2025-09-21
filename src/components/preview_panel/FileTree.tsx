import React from "react";
import { Folder, FolderOpen } from "lucide-react";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { useSetAtom } from "jotai";

interface FileTreeProps {
  files: string[];
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

// Convert flat file list to tree structure
const buildFileTree = (files: string[]): TreeNode[] => {
  const root: TreeNode[] = [];

  files.forEach((path) => {
    const parts = path.split("/");
    let currentLevel = root;

    parts.forEach((part, index) => {
      const isLastPart = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");

      // Check if this node already exists at the current level
      const existingNode = currentLevel.find((node) => node.name === part);

      if (existingNode) {
        // If we found the node, just drill down to its children for the next level
        currentLevel = existingNode.children;
      } else {
        // Create a new node
        const newNode: TreeNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLastPart,
          children: [],
        };

        currentLevel.push(newNode);
        currentLevel = newNode.children;
      }
    });
  });

  return root;
};

// File tree component
export const FileTree = ({ files }: FileTreeProps) => {
  const treeData = buildFileTree(files);

  return (
    <div className="file-tree mt-2">
      <TreeNodes nodes={treeData} level={0} />
    </div>
  );
};

interface TreeNodesProps {
  nodes: TreeNode[];
  level: number;
}

// Sort nodes to show directories first
const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return a.name.localeCompare(b.name);
    }
    return a.isDirectory ? -1 : 1;
  });
};

// Tree nodes component
const TreeNodes = ({ nodes, level }: TreeNodesProps) => (
  <ul className="ml-4">
    {sortNodes(nodes).map((node, index) => (
      <TreeNode key={index} node={node} level={level} />
    ))}
  </ul>
);

interface TreeNodeProps {
  node: TreeNode;
  level: number;
}

// Individual tree node component
const TreeNode = ({ node, level }: TreeNodeProps) => {
  const [expanded, setExpanded] = React.useState(level < 2);
  const setSelectedFile = useSetAtom(selectedFileAtom);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else {
      setSelectedFile({
        path: node.path,
      });
    }
  };

  return (
    <li className="py-0.5">
      <div
        className="flex items-center hover:bg-(--sidebar) rounded cursor-pointer px-1.5 py-0.5 text-sm"
        onClick={handleClick}
      >
        {node.isDirectory && (
          <span className="mr-1 text-gray-500">
            {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
        )}
        <span>{node.name}</span>
      </div>

      {node.isDirectory && expanded && node.children.length > 0 && (
        <TreeNodes nodes={node.children} level={level + 1} />
      )}
    </li>
  );
};
